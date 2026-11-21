#!/bin/bash
# Awai PC: assemble and read back the disk image from Android target-files.
set -euo pipefail

if [[ $# != 3 ]]; then
    echo "Usage: $0 TARGET_FILES STOCK_DISK OUTPUT_DISK" >&2
    exit 2
fi

target_files=$(realpath -- "$1")
stock_disk=$(realpath -- "$2")
output=$(realpath -- "$(dirname -- "$3")")/$(basename -- "$3")
test -f "$target_files"
test -f "$stock_disk"
if [[ -e "$output" || -L "$output" ]]; then
    echo "Output already exists: $output" >&2
    exit 1
fi

check_input() {
    local description=$1 path=$2 expected=$3 digest
    digest=$(sha256sum -- "$path")
    digest=${digest%% *}
    if [[ -n "$expected" && "$digest" != "$expected" ]]; then
        echo "$description SHA-256 differs from the build or signing record" >&2
        return 1
    fi
    printf '%s SHA-256 %s\n' "$description" "$digest"
}

android_root=${AWAI_ANDROID_ROOT:-/root/build/src}
host_out=${AWAI_ANDROID_HOST_OUT:-"$android_root/out/host/linux-x86"}
host_bin="$host_out/bin"
if [[ -n ${AWAI_ANDROID_HOST_OUT:-} ]]; then
    for tool in build_super_image lpmake simg2img; do
        if [[ ! -x "$host_bin/$tool" ]]; then
            echo "Missing Android host tool: $host_bin/$tool" >&2
            exit 1
        fi
    done
fi

check_input "target-files" "$target_files" "${AWAI_TARGET_FILES_SHA256:-}"
check_input "stock disk" "$stock_disk" "${AWAI_STOCK_DISK_SHA256:-}"

export PATH="$host_bin:$android_root/prebuilts/jdk/jdk21/linux-x86/bin:$PATH"
if [[ -n ${AWAI_ANDROID_HOST_OUT:-} ]]; then
    export LD_LIBRARY_PATH="$host_out/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
workspace=$(mktemp -d "$(dirname -- "$output")/.awai-tf-disk.XXXXXX")
trap 'rm -rf -- "$workspace"' EXIT
candidate="$workspace/disk.img"
unzip -q "$target_files" "IMAGES/boot.img" "IMAGES/vendor_boot.img" -d "$workspace"
if ! build_super_image "$target_files" "$workspace/super.img" > "$workspace/super.log" 2>&1; then
    tail -n 15 "$workspace/super.log" >&2
    exit 1
fi
if file -b "$workspace/super.img" | grep -q sparse; then
    simg2img "$workspace/super.img" "$workspace/super.raw"
else
    mv -- "$workspace/super.img" "$workspace/super.raw"
fi

cp --sparse=always -- "$stock_disk" "$candidate"
python3 - "$candidate" "$workspace" "$target_files" <<'PY'
from collections import Counter
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from zipfile import ZipFile

disk, workspace, target_files = map(Path, sys.argv[1:])
partitions = {
    "boot_a": "IMAGES/boot.img",
    "boot_b": "IMAGES/boot.img",
    "vendor_boot_a": "IMAGES/vendor_boot.img",
    "vendor_boot_b": "IMAGES/vendor_boot.img",
    "super": "super.raw",
}

table = subprocess.check_output(["/usr/sbin/sgdisk", "-p", str(disk)], text=True,
                                env={**os.environ, "LC_ALL": "C"})
sector = re.search(r"^(?:Sector size \(logical(?:/physical)?\)|Logical sector size): "
                   r"(\d+)(?:\s*(?:bytes\s*)?/\s*\d+)? bytes$", table, re.MULTILINE)
if not sector or int(sector[1]) != 512:
    sys.exit("expected a stock disk image with 512-byte logical sectors")
rows = re.findall(r"^\s*\d+\s+(\d+)\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(\S+)\s*$",
                  table, re.MULTILINE)
names = Counter(name for _, _, name in rows)
root_names = ("vbmeta", "vbmeta_system", "vbmeta_vendor")
with ZipFile(target_files) as archive:
    avb_properties = [
        value for line in archive.read("META/misc_info.txt").decode().splitlines()
        for key, _, value in (line.strip().partition("="),) if key == "avb_enable"
    ]
    if avb_properties not in ([], ["false"], ["true"]):
        sys.exit("invalid or duplicate target-files avb_enable value")
    avb_enabled = avb_properties == ["true"]
    members = [
        name for name in archive.namelist() if re.fullmatch(r"IMAGES/vbmeta[^/]*\.img", name)
    ]
    allowed = {f"IMAGES/{root}.img": root for root in root_names}
    if len(members) != len(set(members)) or set(members) - allowed.keys():
        sys.exit("invalid or duplicate target-files vbmeta images")
    if avb_enabled != ("IMAGES/vbmeta.img" in members) or (members and not avb_enabled):
        sys.exit("target-files avb_enable and vbmeta images do not match")
    expected_slots = {
        f"{allowed[member]}_{slot}" for member in members for slot in ("a", "b")
    }
    actual_slots = {
        name for name in names if re.match(r"^vbmeta(?:_|$)", name, re.IGNORECASE)
    }
    if expected_slots != actual_slots or any(names[name] != 1 for name in expected_slots):
        sys.exit("stock disk vbmeta slots do not match target-files")
    for member in members:
        root = allowed[member]
        with archive.open(member) as payload, (workspace / member).open("xb") as image:
            header = payload.read(256)
            if len(header) != 256 or not header.startswith(b"AVB0"):
                sys.exit(f"{member}: expected a raw AVB header")
            image.write(header)
            shutil.copyfileobj(payload, image)
        for slot in ("a", "b"):
            partitions[f"{root}_{slot}"] = member
if any(names[name] != 1 for name in partitions):
    sys.exit("expected one partition for each required payload")
ranges = {name: (int(start), int(end)) for start, end, name in rows if name in partitions}

with disk.open("r+b") as image:
    disk_size = disk.stat().st_size
    for name, member in partitions.items():
        start, end = ranges[name]
        payload = workspace / member
        size = payload.stat().st_size
        if end < start or size <= 0 or size > (end - start + 1)*512 or (end + 1)*512 > disk_size:
            sys.exit(f"{name}: invalid disk range or payload size")
        expected = hashlib.sha256()
        actual = hashlib.sha256()
        image.seek(start*512)
        with payload.open("rb") as source:
            for chunk in iter(lambda: source.read(8 << 20), b""):
                image.write(chunk)
                expected.update(chunk)
        image.flush()
        image.seek(start*512)
        remaining = size
        while remaining:
            chunk = image.read(min(remaining, 8 << 20))
            if not chunk:
                sys.exit(f"{name}: short read after writing disk image")
            actual.update(chunk)
            remaining -= len(chunk)
        if actual.digest() != expected.digest():
            sys.exit(f"{name}: readback mismatch")
        print(name, size, actual.hexdigest())
    os.fsync(image.fileno())
PY

digest=$(sha256sum -- "$candidate")
# Publish only after all checks. The hard link refuses an existing destination atomically.
ln -T -- "$candidate" "$output"
printf '%s  %s\n' "${digest%% *}" "$output"
