#!/usr/bin/env python3
"""AWAI-3586: add the Awai A/B partitions to a disk that already has partitions, without touching them.

  awai-pc-install.py plan  <target disk or image> <source disk image> [--userdata-gib N]
  awai-pc-install.py apply <target disk or image> <source disk image> [--userdata-gib N] [--source-sha256 SHA256] --record out.json

The source is the disk image the build makes (disk-vda.img). Each Awai partition is copied from the
partition of the same name in it. Nothing is written outside the new partitions and the GPT.
`plan` writes nothing. `apply` refuses when a name is already used, when the free space is too small, or
when a planned range overlaps an existing partition. It reads back the new layout and copied data
and checks that every existing partition has the same SHA-256.
"""
import hashlib
import json
import os
import re
import stat
import subprocess
import sys

SECTOR = 512
ALIGN = 2048
# name on the target, name in the source image (None: created empty), fixed partition GUID or None, type code
LAYOUT = [
    ("awai_esp",      "EFI",           None,                                   "ef00"),
    ("super",         "super",         None,                                   "8300"),
    ("misc",          None,            "41574149-0000-4d49-8000-000000000001", "8300"),
    ("persist",       "persist",       None,                                   "8300"),
    ("metadata",      None,            None,                                   "8300"),
    ("firmware",      "firmware",      None,                                   "8300"),
    ("vendor_boot_a", "vendor_boot_a", "41574149-0000-5642-8000-00000000000a", "8300"),
    ("vendor_boot_b", "vendor_boot_b", "41574149-0000-5642-8000-00000000000b", "8300"),
    ("boot_a",        "boot_a",        "41574149-0000-424f-8000-00000000000a", "8300"),
    ("boot_b",        "boot_b",        "41574149-0000-424f-8000-00000000000b", "8300"),
    ("userdata",      None,            None,                                   "8300"),
]
EMPTY_SECTORS = {"misc": 2048, "metadata": 65536}
RESERVED = {n for n, _, _, _ in LAYOUT} | {"efi", "bios", "cache", "recovery", "boot", "vendor_boot"}


def sgdisk(*a):
    return subprocess.run(
        ["sgdisk", *a], check=True, capture_output=True, text=True,
        env={**os.environ, "LC_ALL": "C"},
    ).stdout


def table(path):
    out = sgdisk("-p", path)
    logical_size = re.search(
        r"^(?:Sector size \(logical(?:/physical)?\)|Logical sector size): "
        r"(\d+)(?:\s*(?:bytes\s*)?/\s*\d+)? bytes$",
        out, re.MULTILINE,
    )
    if not logical_size or int(logical_size[1]) != SECTOR:
        sys.exit(f"REFUSED {path}: expected {SECTOR}-byte logical sectors")
    parts = []
    for line in out.splitlines():
        m = re.match(r"\s*(\d+)\s+(\d+)\s+(\d+)\s+\S+\s+\S+\s+(\S+)\s*(.*)$", line)
        if m:
            parts.append({"number": int(m[1]), "start": int(m[2]), "end": int(m[3]), "type": m[4], "name": m[5].strip()})
    last = int(re.search(r"last usable sector is (\d+)", out)[1])
    first = int(re.search(r"First usable sector is (\d+)", out)[1])
    return parts, first, last


def read_range(file, start, end):
    file.seek(start * SECTOR)
    remaining = (end - start + 1) * SECTOR
    while remaining:
        chunk = file.read(min(remaining, 8 << 20))
        if not chunk:
            sys.exit(f"FAILED short read from {file.name} at byte {file.tell()} (sectors {start}–{end})")
        remaining -= len(chunk)
        yield chunk


def sha_range(path, start, end):
    digest = hashlib.sha256()
    with open(path, "rb") as file:
        for chunk in read_range(file, start, end):
            digest.update(chunk)
    return digest.hexdigest()


def free_ranges(parts, first, last):
    cur, out = first, []
    for p in sorted(parts, key=lambda p: p["start"]):
        if p["start"] > cur:
            out.append((cur, p["start"] - 1))
        cur = max(cur, p["end"] + 1)
    if cur <= last:
        out.append((cur, last))
    return out


def make_plan(target, source, userdata_gib):
    if userdata_gib <= 0:
        sys.exit("REFUSED userdata size must be positive")
    if os.path.samefile(target, source):
        sys.exit("REFUSED source and target identify the same file or device")
    tparts, tfirst, tlast = table(target)
    sparts, _, _ = table(source)
    src = {p["name"]: p for p in sparts}
    clash = sorted(p["name"] for p in tparts if p["name"].lower() in RESERVED)
    if clash:
        sys.exit(f"REFUSED name-in-use: {clash}")
    need = []
    for name, sname, guid, code in LAYOUT:
        if sname:
            if sname not in src:
                sys.exit(f"REFUSED source-has-no-partition: {sname}")
            sectors = src[sname]["end"] - src[sname]["start"] + 1
        elif name == "userdata":
            sectors = userdata_gib * (1 << 30) // SECTOR
        else:
            sectors = EMPTY_SECTORS[name]
        need.append((name, sname, guid, code, sectors))
    total = sum(-(-n[4] // ALIGN) * ALIGN for n in need)
    best = None
    for a, b in free_ranges(tparts, tfirst, tlast):
        a2 = -(-a // ALIGN) * ALIGN
        if b - a2 + 1 >= total and (best is None or b - a2 > best[1] - best[0]):
            best = (a2, b)
    if best is None:
        sys.exit(f"REFUSED not-enough-free-space: need {total} sectors in one free range, free ranges {free_ranges(tparts, tfirst, tlast)}")
    used = {p["number"] for p in tparts}
    cur, num, new = best[0], 1, []
    for name, sname, guid, code, sectors in need:
        while num in used:
            num += 1
        used.add(num)
        new.append({"number": num, "name": name, "start": cur, "end": cur + sectors - 1, "type": code, "guid": guid,
                    "from": None if not sname else {"name": sname, "start": src[sname]["start"], "end": src[sname]["end"]}})
        cur = -(-(cur + sectors) // ALIGN) * ALIGN
    for n in new:
        for p in tparts:
            if not (n["end"] < p["start"] or n["start"] > p["end"]):
                sys.exit(f"REFUSED overlap: {n['name']} with partition {p['number']}")
    return {"schema": "awai.pc.ab-install.plan.v1", "target": os.path.basename(target), "source": os.path.basename(source),
            "existing": tparts, "freeRangeUsed": list(best), "new": new}


def partition_shape(row):
    return row["start"], row["end"], row["type"].upper(), row["name"]


def source_identity(metadata):
    return metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns


def apply(target, source, plan, record, source_sha256=None):
    if os.path.lexists(record):
        sys.exit(f"REFUSED {record}: install record already exists")
    expected = {}
    with open(source, "rb") as s:
        source_stat = os.fstat(s.fileno())
        required_size = max((n["from"]["end"] + 1) * SECTOR for n in plan["new"] if n["from"])
        if stat.S_ISREG(source_stat.st_mode) and source_stat.st_size < required_size:
            sys.exit(f"REFUSED {source}: source image is shorter than its partition table")
        if source_sha256 and hashlib.file_digest(s, "sha256").hexdigest() != source_sha256:
            sys.exit(f"REFUSED {source}: source image digest does not match the release record")
        before = {p["number"]: sha_range(target, p["start"], p["end"]) for p in plan["existing"]}
        if source_identity(source_stat) != source_identity(os.stat(source)):
            sys.exit(f"REFUSED {source}: source changed during verification")
        if table(target)[0] != plan["existing"]:
            sys.exit(f"REFUSED {target}: target partition table changed during verification")
        for n in plan["new"]:
            args = [f"--new={n['number']}:{n['start']}:{n['end']}", f"--typecode={n['number']}:{n['type']}", f"--change-name={n['number']}:{n['name']}"]
            if n["guid"]:
                args.append(f"--partition-guid={n['number']}:{n['guid']}")
            sgdisk(*args, target)
        with open(target, "r+b") as t:
            for n in plan["new"]:
                t.seek(n["start"] * SECTOR)
                if n["from"]:
                    end = n["end"]
                    chunks = read_range(s, n["from"]["start"], n["from"]["end"])
                else:
                    # Zero the first MiB so Android formats new, empty partitions.
                    end = min(n["end"], n["start"] + (1 << 20) // SECTOR - 1)
                    chunks = [bytes((end - n["start"] + 1) * SECTOR)]
                digest = hashlib.sha256()
                for chunk in chunks:
                    if t.write(chunk) != len(chunk):
                        sys.exit(f"FAILED {n['name']}: short write to target")
                    digest.update(chunk)
                expected[n["name"]] = (end, digest.hexdigest())
            t.flush()
            os.fsync(t.fileno())
        if source_identity(source_stat) != source_identity(os.fstat(s.fileno())):
            sys.exit(f"FAILED {source}: source changed during copying")

    after_parts, _, _ = table(target)
    by_number = {p["number"]: p for p in after_parts}
    after = {}
    for p in plan["existing"]:
        q = by_number.get(p["number"])
        if q is None or partition_shape(q) != partition_shape(p):
            sys.exit(f"FAILED existing partition {p['number']}: GPT entry changed")
        after[p["number"]] = sha_range(target, p["start"], p["end"])
        if after[p["number"]] != before[p["number"]]:
            sys.exit(f"FAILED existing partition {p['number']}: data changed")

    new_hashes = {}
    for n in plan["new"]:
        q = by_number.get(n["number"])
        name = n["name"]
        if q is None or partition_shape(q) != partition_shape(n):
            sys.exit(f"FAILED {name}: new GPT entry differs from the plan")
        if n["guid"]:
            detail = sgdisk(f"-i{n['number']}", target)
            if f"Partition unique GUID: {n['guid'].upper()}\n" not in detail:
                sys.exit(f"FAILED {name}: new GPT partition GUID differs from the plan")
        end, expected_digest = expected[name]
        actual = sha_range(target, n["start"], end)
        if actual != expected_digest:
            sys.exit(f"FAILED {name}: written data differs on readback")
        new_hashes[name] = {"start": n["start"], "end": end, "sha256": actual}

    out = dict(plan, schema="awai.pc.ab-install.record.v1", existingSha256Before=before,
               existingSha256After=after, existingUnchanged=True,
               sourceSha256=source_sha256, newPartitionReadback=new_hashes)
    with open(record, "x") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    print(json.dumps({"existingUnchanged": True, "newPartitionsVerified": len(new_hashes),
                      "record": os.fspath(record)}))


def main():
    a = sys.argv[1:]
    if len(a) < 3 or a[0] not in ("plan", "apply"):
        sys.exit(__doc__)
    gib = int(a[a.index("--userdata-gib") + 1]) if "--userdata-gib" in a else 16
    plan = make_plan(a[1], a[2], gib)
    if a[0] == "plan":
        print(json.dumps(plan, indent=2))
        return
    if "--record" not in a:
        sys.exit("apply needs --record FILE")
    expected_sha256 = a[a.index("--source-sha256") + 1] if "--source-sha256" in a else None
    if expected_sha256 is not None and not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        sys.exit("REFUSED --source-sha256 must be a lowercase SHA-256 digest")
    apply(a[1], a[2], plan, a[a.index("--record") + 1], expected_sha256)


if __name__ == "__main__":
    main()
