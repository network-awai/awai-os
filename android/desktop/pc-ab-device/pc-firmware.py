#!/usr/bin/env python3
"""Prepare and verify the pinned Radeon and Realtek PC firmware."""
import argparse
from collections import Counter
import hashlib
import io
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
from zipfile import BadZipFile, ZipFile

REVISION = "a2dcb924f0897368b0b4f305cbf9808cdda90ce0"
OVERLAY = Path("vendor/awai/pc-firmware")
MAINLINE_REALTEK = Path("external/linux-firmware-mainline/firmware/r8168")
DEVICE = Path("device/virt/virtio_x86_64")
DEVICE_REVISION = "50dc14712023705ccf477af49a27ef9109b54d19"
PRODUCT = DEVICE / "lineage_virtio_x86_64.mk"
PATCHES = Path(__file__).resolve().parent / "patches"
# The Radeon entry, then the factory default that selects it on an AMD GPU without a virtio GPU.
RADEON_PATCHES = (PATCHES / "virtio-x86-64-awai-radeon.patch", PATCHES / "virtio-x86-64-awai-radeon-default.patch")
PRODUCT_MARKER = "PRODUCT_NAME := lineage_virtio_x86_64\n"
INCLUDE = f"$(call inherit-product, {OVERLAY}/firmware.mk)\n"
NOTICES = ("LICENSES/LICENSE.amdgpu", "LICENSES/LICENSE.r8169", "LICENSES/LICENCE.rtlwifi_firmware.txt", "WHENCE")
# AWAI-4092: rtw89/rtw8851b_fw.bin only. At kernel/virt/virtio 604b22fb,
# RTW8851B_FW_FORMAT_MAX is 0, so the driver never requests rtw8851b_fw-1.bin.
FIRMWARE = re.compile(r"(amdgpu/(yellow_carp_[a-z0-9_]+|vcn_3_1_2)\.bin|rtl_nic/rtl8168[a-z0-9-]+\.fw|rtw89/rtw8851b_fw\.bin)")


def git(repository, *args):
    return subprocess.check_output(["git", "-C", str(repository), *args])


def pinned_files(repository):
    paths = git(repository, "ls-tree", "-r", "--name-only", REVISION, "amdgpu", "rtl_nic", "rtw89")
    binaries = [path for path in paths.decode().splitlines() if FIRMWARE.fullmatch(path)]
    if len(binaries) != 27:
        raise ValueError("unexpected firmware selection in the pinned tree")
    archive = git(repository, "archive", REVISION, *binaries, *NOTICES)
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as source:
        return {path: source.extractfile(path).read() for path in (*binaries, *NOTICES)}


def installed_files(files):
    return {
        str(Path("firmware") / path) if FIRMWARE.fullmatch(path)
        else str(Path("etc/awai-pc-firmware") / Path(path).name): data
        for path, data in files.items()
    } | {"etc/awai-pc-firmware/revision.txt": (REVISION + "\n").encode()}


def prepare(source, firmware):
    device = source / DEVICE
    if git(device, "rev-parse", "HEAD").decode().strip() != DEVICE_REVISION:
        raise ValueError("unexpected virtio_x86_64 device revision")
    pending = [
        patch for patch in RADEON_PATCHES
        if subprocess.run(
            ["git", "-C", str(device), "apply", "--reverse", "--check", str(patch)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        ).returncode
    ]
    for patch in pending:
        git(device, "apply", "--check", str(patch))
    product = source / PRODUCT
    existing = product.read_text()
    if existing.count(PRODUCT_MARKER) != 1 or existing.count(INCLUDE) > 1:
        raise ValueError("unexpected x86_64 product makefile")
    expected_files = installed_files(pinned_files(firmware))
    files = {}
    for path, data in expected_files.items():
        if path.startswith("firmware/rtl_nic/"):
            # Soong's linux_firmware_r8168 already owns these destinations.
            upstream = source / MAINLINE_REALTEK / Path(path).relative_to("firmware")
            if upstream.read_bytes() != data:
                raise ValueError(f"{upstream} does not match the pinned revision")
        else:
            files[path] = data
    overlay = source / OVERLAY
    mapping = [
        f"    {OVERLAY}/{path}:$(TARGET_COPY_OUT_VENDOR)/{path}" for path in sorted(files)
    ]
    files["firmware.mk"] = (
        "PRODUCT_PACKAGES += linux_firmware_r8168\n\n"
        "PRODUCT_COPY_FILES += \\\n" + " \\\n".join(mapping) + "\n"
    ).encode()
    if overlay.exists():
        actual = {str(path.relative_to(overlay)): path.read_bytes()
                  for path in overlay.rglob("*") if path.is_file()}
        if actual != files:
            raise ValueError("existing firmware overlay differs from the pinned input")
    else:
        overlay.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".pc-firmware-", dir=overlay.parent) as temporary:
            stage = Path(temporary) / "overlay"
            for path, data in files.items():
                destination = stage / path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(data)
            stage.rename(overlay)
    for patch in pending:
        git(device, "apply", str(patch))
    if INCLUDE not in existing:
        with tempfile.TemporaryDirectory(prefix=".pc-firmware-", dir=product.parent) as temporary:
            stage = Path(temporary) / product.name
            stage.write_text(existing.replace(PRODUCT_MARKER, INCLUDE + "\n" + PRODUCT_MARKER))
            stage.chmod(product.stat().st_mode)
            stage.replace(product)


def verify(target_files, firmware):
    files = installed_files(pinned_files(firmware))
    with ZipFile(target_files) as package:
        names = Counter(package.namelist())
        for path, expected in files.items():
            member = f"VENDOR/{path}"
            if names[member] != 1:
                raise ValueError(f"expected one {member}")
            if package.read(member) != expected:
                raise ValueError(f"{member} does not match the pinned revision")
    for path in sorted(files):
        print(f"{hashlib.sha256(files[path]).hexdigest()}  VENDOR/{path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(required=True, dest="command")
    stage = commands.add_parser("prepare")
    stage.add_argument("source", type=Path)
    stage.add_argument("firmware", type=Path)
    inspect = commands.add_parser("verify")
    inspect.add_argument("target_files", type=Path)
    inspect.add_argument("firmware", type=Path)
    options = parser.parse_args()
    try:
        if options.command == "prepare":
            prepare(options.source, options.firmware)
        else:
            verify(options.target_files, options.firmware)
    except (BadZipFile, OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
