#!/usr/bin/env python3
"""Prepare Android target-files for local signing without access to release keys."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from zipfile import BadZipFile, ZipFile


METADATA = "META/misc_info.txt"


def archive_receipt(archive):
    members = archive.infolist()
    if sum(member.filename == METADATA for member in members) != 1:
        raise ValueError(f"expected one {METADATA} entry")
    return sorted(
        (member.filename, member.file_size, member.CRC)
        for member in members if member.filename != METADATA
    )


def prepare(source, expected_sha256, destination):
    if os.path.lexists(destination):
        raise FileExistsError(f"destination already exists: {destination}")
    with TemporaryDirectory(dir=destination.parent, prefix=".prepare-target-files-") as directory:
        work = Path(directory)
        candidate = work / "target-files.zip"
        digest = hashlib.sha256()
        with source.open("rb") as raw, candidate.open("xb") as prepared:
            for chunk in iter(lambda: raw.read(4 * 1024 * 1024), b""):
                digest.update(chunk)
                prepared.write(chunk)
        if digest.hexdigest() != expected_sha256:
            raise ValueError("source SHA-256 differs from the build record")

        with ZipFile(candidate) as archive:
            unchanged = archive_receipt(archive)
            metadata = archive.read(METADATA).decode("utf-8")
        tool_entries = [line for line in metadata.splitlines() if line.startswith("avb_avbtool=")]
        if len(tool_entries) > 1 or tool_entries == ["avb_avbtool="]:
            raise ValueError("invalid avb_avbtool declaration")
        if not tool_entries:
            metadata = metadata.rstrip("\n") + "\navb_avbtool=avbtool\n"
            member_path = work / METADATA
            member_path.parent.mkdir()
            member_path.write_text(metadata, encoding="utf-8")
            subprocess.run(["zip", "-q", "-X", str(candidate), METADATA], cwd=work, check=True)

        with ZipFile(candidate) as archive:
            if archive_receipt(archive) != unchanged or archive.read(METADATA) != metadata.encode():
                raise ValueError("unexpected target-files member changes")
        finished = hashlib.sha256()
        with candidate.open("rb") as prepared:
            for chunk in iter(lambda: prepared.read(4 * 1024 * 1024), b""):
                finished.update(chunk)
        os.link(candidate, destination)
    return {"sourceSha256": expected_sha256, "preparedSha256": finished.hexdigest(),
            "unchangedMembers": len(unchanged), "addedAvbTool": not tool_entries}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--source-sha256", required=True)
    args = parser.parse_args()
    try:
        receipt = prepare(args.source, args.source_sha256, args.destination.parent.resolve() / args.destination.name)
    except (BadZipFile, OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"{error}\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
