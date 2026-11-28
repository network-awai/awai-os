#!/usr/bin/env python3
"""Compare one slot of an immutable Awai PC install image with source target-files."""

import argparse
import hashlib
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile


spec = spec_from_file_location("awai_pc_install", Path(__file__).with_name("awai-pc-install.py"))
installer = module_from_spec(spec)
spec.loader.exec_module(installer)
CHUNK = 8 << 20
SPARSE_MAGIC = bytes.fromhex("3aff26ed")


def file_digest(path):
    if not path.is_file():
        raise ValueError(f"{path.name}: expected a regular file")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_digest(path, expected):
    if not re.fullmatch(r"[0-9a-f]{64}", expected) or file_digest(path) != expected:
        raise ValueError(f"{path.name}: SHA-256 does not match the independent record")


def only_entry(archive, name):
    matches = [entry for entry in archive.infolist() if entry.filename == name]
    if len(matches) != 1 or not matches[0].file_size:
        raise ValueError(f"expected exactly one nonempty {name}")
    return matches[0]


def inventory(archive):
    manifest = only_entry(archive, "META/ab_partitions.txt")
    if manifest.file_size > 8192:
        raise ValueError("unexpected A/B partition inventory size")
    names = archive.read(manifest).decode("ascii").split()
    if len(names) != len(set(names)) or not names or not all(re.fullmatch(r"[a-z0-9_]+", n) for n in names):
        raise ValueError("invalid A/B partition inventory")
    return {name: only_entry(archive, f"IMAGES/{name}.img") for name in names}


def dynamic_partitions(archive):
    metadata = only_entry(archive, "META/dynamic_partitions_info.txt")
    if metadata.file_size > 65536:
        raise ValueError("unexpected dynamic partition metadata size")
    fields = {}
    for line in archive.read(metadata).decode("ascii").splitlines():
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition("=")
        if key in fields:
            raise ValueError(f"duplicate dynamic partition property {key}")
        fields[key] = value
    if fields.get("super_block_devices") != "super" or fields.get("super_metadata_device") != "super":
        raise ValueError("expected a single GPT super partition")
    return set(fields.get("dynamic_partition_list", "").split())


def ranges(path):
    if "No problems found." not in installer.sgdisk("-v", path):
        raise ValueError("invalid GPT")
    parts, first, last = installer.table(path)
    region_end = first - 1
    result = {}
    for part in sorted(parts, key=lambda row: row["start"]):
        name, start, end = part["name"], part["start"], part["end"]
        if name in result or not region_end < start <= end <= last or (end + 1) * installer.SECTOR > path.stat().st_size:
            raise ValueError(f"{name}: duplicate or invalid GPT range")
        result[name] = start, end
        region_end = end
    return result


def hash_bytes(stream, size, *, raw_target=False):
    digest = hashlib.sha256()
    remaining = size
    while remaining:
        chunk = stream.read(min(remaining, CHUNK))
        if not chunk:
            raise ValueError("unexpected end of image")
        if raw_target and remaining == size and chunk.startswith(SPARSE_MAGIC):
            raise ValueError("source target-files must contain raw A/B images")
        digest.update(chunk)
        remaining -= len(chunk)
    return digest.hexdigest()


def measure(archive, entry, media, offset, available, *, exact_size=False):
    with archive.open(entry) as stream:
        expected = hash_bytes(stream, entry.file_size, raw_target=True)
    row = {"bytes": entry.file_size, "capacityBytes": available, "targetSha256": expected}
    if available < entry.file_size or (exact_size and available != entry.file_size):
        return {**row, "status": "FAIL", "reason": "source-partition-size-mismatch"}
    media.seek(offset)
    actual = hash_bytes(media, entry.file_size)
    if actual != expected:
        return {**row, "mediaSha256": actual, "status": "FAIL", "reason": "source-partition-digest-mismatch"}
    return {**row, "mediaSha256": actual, "status": "PASS"}


def unpack_logical(args, media, super_range, names, destination):
    start, end = super_range
    size = (end - start + 1) * installer.SECTOR
    if shutil.disk_usage(args.scratch).free < 2 * size:
        raise ValueError(f"need at least {2 * size} bytes for super and extracted logical images")
    require_digest(args.lpunpack, args.lpunpack_sha256)
    image = destination / "super.raw"
    with image.open("xb") as target:
        for data in installer.read_range(media, start, end):
            target.write(data)
    output = destination / "logical"
    output.mkdir()
    flags = [item for name in names for item in ("--partition", name)]
    subprocess.run([str(args.lpunpack.resolve()), "--slot", str("ab".index(args.slot)), *flags, image, output],
                   check=True, stdout=subprocess.DEVNULL)
    if {file.name for file in output.iterdir()} != {f"{name}.img" for name in names}:
        raise ValueError("lpunpack did not return the requested logical partitions")
    return output


def check(args):
    require_digest(args.disk, args.disk_sha256)
    require_digest(args.target_files, args.target_sha256)
    gpt = ranges(args.disk)
    with args.disk.open("rb") as media, zipfile.ZipFile(args.target_files) as archive:
        entries = inventory(archive)
        rows = {}
        logical = {}
        for partition, entry in entries.items():
            name = f"{partition}_{args.slot}"
            if name not in gpt:
                logical[name] = entry
                continue
            start, end = gpt[name]
            rows[name] = measure(archive, entry, media, start * installer.SECTOR,
                                 (end - start + 1) * installer.SECTOR)
        if logical or "META/dynamic_partitions_info.txt" in archive.namelist():
            dynamic = dynamic_partitions(archive)
            if any(name[:-2] in dynamic for name in rows):
                raise ValueError("an A/B partition appears in both GPT and the logical inventory")
        if logical:
            if "super" not in gpt or any(name[:-2] not in dynamic for name in logical):
                raise ValueError("an A/B partition has no GPT entry and no declared logical image")
            if any(row["status"] != "PASS" for row in rows.values()):
                rows.update({name: {"status": "NOT_CHECKED", "reason": "physical-partition-mismatch"}
                             for name in logical})
            else:
                with tempfile.TemporaryDirectory(prefix="awai-media-source-", dir=args.scratch) as temporary:
                    images = unpack_logical(args, media, gpt["super"], logical, Path(temporary))
                    for name, entry in logical.items():
                        image = images / f"{name}.img"
                        with image.open("rb") as raw:
                            rows[name] = measure(archive, entry, raw, 0, image.stat().st_size, exact_size=True)
    matches = all(row["status"] == "PASS" for row in rows.values())
    return {"diskSha256": args.disk_sha256, "targetFilesSha256": args.target_sha256,
            "slot": args.slot, "incrementalSourceMatches": matches, "partitions": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ("disk", "target-files", "scratch", "lpunpack"):
        parser.add_argument(f"--{option}", type=Path, required=True)
    for option in ("disk-sha256", "target-sha256", "lpunpack-sha256"):
        parser.add_argument(f"--{option}", required=True)
    parser.add_argument("--slot", choices=("a", "b"), required=True)
    try:
        result = check(parser.parse_args())
    except (OSError, ValueError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        parser.exit(1, f"OTA source parity unavailable: {error}\n")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["incrementalSourceMatches"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
