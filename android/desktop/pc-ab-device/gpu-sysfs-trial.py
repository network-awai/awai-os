#!/usr/bin/env python3
"""AWAI-4090: try the GPU sysfs label on a booted debug ramdisk, without flashing.

Writes `userdebug_plat_sepolicy.cil`: the image's own /system/etc/selinux/plat_sepolicy.cil with
one `genfscon sysfs <GPU PCI path> sysfs_gpu` line per GPU appended. Nothing else changes: no allow,
no neverallow, no permissive. The type `sysfs_gpu` is declared by the platform policy.

With `/force_debuggable` in the ramdisk and an unlocked device, second-stage init compiles
/debug_ramdisk/userdebug_plat_sepolicy.cil in place of plat_sepolicy.cil and skips the precompiled
vendor policy (system/core init/selinux.cpp, OpenSplitPolicy). First-stage init copies the file from the
ramdisk root. So the file has to be in the ramdisk root; this script also writes it as a one-file cpio
that can be appended to the ramdisk as one more initrd.

The script only reads the files it is given and writes into --out-dir. It never talks to a device.

    gpu-sysfs-trial.py --plat-cil plat_sepolicy.cil [--vendor-cil vendor_sepolicy.cil] \
        [--gpu-path /sys/devices/pci0000:00/0000:00:08.1/0000:05:00.0 ...] --out-dir OUT

Without --gpu-path the paths are the ones the source patch adds (patches/virtio-common-awai-pc-gpu-sysfs.patch).
"""
import argparse
import gzip
import hashlib
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PATCH = HERE / "patches" / "virtio-common-awai-pc-gpu-sysfs.patch"
TYPE = "sysfs_gpu"
CIL_NAME = "userdebug_plat_sepolicy.cil"
CPIO_NAME = "awai-gpu-sysfs-initrd.cpio"

# One or more PCI functions below the root bus: /devices/pci0000:00/0000:00:08.1/0000:05:00.0
_BDF = r"[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]"
PCI_PATH = re.compile(rf"^/devices/pci[0-9a-f]{{4}}:[0-9a-f]{{2}}(/{_BDF})+$")
_GENFSCON = re.compile(r'^\(genfscon\s+(\S+)\s+"([^"]*)"\s+\(\s*\S+\s+\S+\s+(\S+)', re.M)


class TrialError(Exception):
    pass


def normalize_path(path):
    """`/sys/devices/...` or `/devices/...` in, `/devices/...` out. Rejects anything but a PCI function path."""
    path = path.strip()
    if path.startswith("/sys/"):
        path = path[len("/sys"):]
    if not PCI_PATH.match(path):
        raise TrialError(
            f"not a PCI function path under pciDDDD:BB: {path!r}. Use the GPU itself, e.g. the output of "
            "`readlink -f /sys/class/drm/card0/device`, never a root bus or a wildcard")
    return path


def patch_paths(patch_text):
    """GPU paths the source patch adds to sepolicy/vendor/genfs_contexts."""
    paths = []
    for line in patch_text.splitlines():
        if line.startswith("+genfscon sysfs "):
            fields = line[1:].split()
            if fields[3] == f"u:object_r:{TYPE}:s0":
                paths.append(fields[2])
    return paths


def genfscon_entries(cil_text):
    """[(fstype, path, type)] for every genfscon line of a CIL file."""
    return [(m.group(1), m.group(2), m.group(3)) for m in _GENFSCON.finditer(cil_text)]


def resolve(entries, path, fstype="sysfs"):
    """The type the kernel gives a sysfs file: the longest genfscon prefix, else the root `sysfs` label."""
    best = None
    for fs, prefix, label in entries:
        if fs == fstype and path.startswith(prefix) and (best is None or len(prefix) > len(best[0])):
            best = (prefix, label)
    return best[1] if best else "sysfs"


def build_cil(plat_text, paths, vendor_text=""):
    if not re.search(rf"^\(type {TYPE}\)\s*$", plat_text, re.M):
        raise TrialError(f"the platform policy does not declare (type {TYPE}); is this plat_sepolicy.cil?")
    if not paths:
        raise TrialError("no GPU path given")
    existing = genfscon_entries(plat_text) + genfscon_entries(vendor_text)
    lines = []
    for path in paths:
        for fs, prefix, label in existing:
            if fs == "sysfs" and prefix == path:
                if label == TYPE:
                    break  # already labeled by the image; adding it again would be a duplicate genfscon
                raise TrialError(f"{path} is already labeled {label} by the image policy")
        else:
            lines.append(f'(genfscon sysfs "{path}" (u object_r {TYPE} ((s0) (s0))))')
    out = plat_text if plat_text.endswith("\n") else plat_text + "\n"
    if lines:
        out += "\n; AWAI-4090: GPU PCI function readable by gpu_sphal_domain (label only).\n" + "\n".join(lines) + "\n"
    return out


def newc_cpio(files):
    """A cpio archive (newc) of regular files at the archive root. Reproducible: no timestamps."""
    out = bytearray()

    def pad(n):
        out.extend(b"\0" * (-n % 4))

    def member(name, data, ino, mode):
        raw = name.encode() + b"\0"
        header = "070701" + "".join(f"{v:08x}" for v in (
            ino, mode, 0, 0, 1, 0, len(data), 0, 0, 0, 0, len(raw), 0))
        out.extend(header.encode())
        out.extend(raw)
        pad(110 + len(raw))
        out.extend(data)
        pad(len(data))

    for ino, (name, data) in enumerate(sorted(files.items()), start=1):
        member(name, data, ino, 0o100644)
    member("TRAILER!!!", b"", 0, 0)
    return bytes(out)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--plat-cil", required=True, type=Path, help="plat_sepolicy.cil pulled from the image under test")
    ap.add_argument("--vendor-cil", type=Path, help="vendor_sepolicy.cil of the same image (checks for a duplicate label)")
    ap.add_argument("--gpu-path", action="append", help="GPU PCI path, repeatable; default: the paths the patch adds")
    ap.add_argument("--out-dir", required=True, type=Path)
    args = ap.parse_args(argv)

    try:
        paths = [normalize_path(p) for p in (args.gpu_path or patch_paths(PATCH.read_text()))]
        plat = args.plat_cil.read_text()
        vendor = args.vendor_cil.read_text() if args.vendor_cil else ""
        cil = build_cil(plat, paths, vendor)
    except (TrialError, OSError) as err:
        print(f"gpu-sysfs-trial: {err}", file=sys.stderr)
        return 1

    args.out_dir.mkdir(parents=True, exist_ok=True)
    targets = {CIL_NAME: cil.encode(), CPIO_NAME: newc_cpio({CIL_NAME: cil.encode()})}
    targets[CPIO_NAME + ".gz"] = gzip.compress(targets[CPIO_NAME], mtime=0)
    for name in targets:
        if (args.out_dir / name).exists():
            print(f"gpu-sysfs-trial: {args.out_dir / name} exists; use a new --out-dir", file=sys.stderr)
            return 1
    for name, data in targets.items():
        (args.out_dir / name).write_bytes(data)
        print(f"{sha256(data)}  {args.out_dir / name}")
    print("labeled:", *paths, sep="\n  ")
    print(NEXT_STEPS.format(cpio=CPIO_NAME, cil=CIL_NAME, path=paths[0]))
    return 0


NEXT_STEPS = """
Use it (the machine stays untouched until you do this yourself):
 1. Ramdisk root needs /force_debuggable (the rig has it: ro.force.debuggable=1) and the device must be
    unlocked. Add {cpio} (or the .gz) to the boot as one more initrd after the existing ramdisk, or put
    {cil} at the ramdisk root. First-stage init copies it to /debug_ramdisk/.
 2. After boot:
      adb logcat -b all -d | grep 'Using userdebug system sepolicy'
      adb shell ls -Z /sys{path}/uevent      # expect u:object_r:sysfs_gpu:s0
      adb logcat -b all -d | grep 'avc: .*denied' | grep -E 'name="(uevent|drm|vendor|device)"'
      adb shell dumpsys SurfaceFlinger | grep -i -E 'GLES|renderengine'
 3. Undo: boot without the extra initrd. Nothing is written to a disk.
"""

if __name__ == "__main__":
    sys.exit(main())
