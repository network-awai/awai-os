#!/usr/bin/env python3
"""AWAI-3563: check which GRUB entry an Awai PC disk starts by default.

  boot-default.py cfg   <grub.cfg>          check an assembled grub.cfg
  boot-default.py env   <grubenv>           print the grubenv settings
  boot-default.py image <disk image>        check the ESP grub.cfg and the persist grubenv of a disk

The grubenv on the persist partition holds grub_android_default. The build writes 0 (the first menu
entry, the virtio GPU path). The device grub.cfg replaces only that factory value: on a PC with an AMD
display controller (PCI vendor 1002, class 03) and no virtio GPU (1af4:1050) it starts
"Awai PC (AMD Radeon, Mesa graphics)". An entry the user picked is saved by name and is kept.

`image` reads both FAT partitions with mtools (mcopy) and changes nothing. It prints a JSON record and exits 1 when a check fails.
"""
import json
import re
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

SECTOR = 512
RADEON_ID = "advancedoptions-virtio_x86_64>android-awai-pc-amd-mesa"
RADEON_ARGS = ("androidboot.gpu=amdgpu", "androidboot.graphics=mesa", "virtio_gpu.modeset=0")
ENV_HEADER = b"# GRUB Environment Block\n"
ENV_SIZE = 1024


def gpt(path):
    with open(path, "rb") as f:
        f.seek(SECTOR)
        header = f.read(92)
        if header[:8] != b"EFI PART":
            raise ValueError(f"{path}: no GPT header")
        lba, count, size = struct.unpack("<QII", header[72:88])
        f.seek(lba * SECTOR)
        table = f.read(count * size)
    parts = {}
    for i in range(count):
        entry = table[i * size:(i + 1) * size]
        if entry[:16] == bytes(16):
            continue
        first, last = struct.unpack("<QQ", entry[32:48])
        name = entry[56:128].decode("utf-16le").rstrip("\0")
        parts[name] = (first, last)
    return parts


def parse_env(block):
    if not block.startswith(ENV_HEADER) or len(block) != ENV_SIZE:
        raise ValueError("not a 1024-byte GRUB environment block")
    env = {}
    for line in block[len(ENV_HEADER):].decode().split("\n"):
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env[key] = value
    return env


def mcopy(image, first, name):
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out"
        subprocess.run(["mcopy", "-n", "-i", f"{image}@@{first * SECTOR}", name, str(out)],
                       check=True, capture_output=True)
        return out.read_bytes()


def block(cfg, opener):
    """Text of the brace block that starts at the first line matching `opener`."""
    m = re.search(opener, cfg, re.MULTILINE)
    if not m:
        return None, -1
    depth, i = 0, cfg.index("{", m.start())
    for j in range(i, len(cfg)):
        depth += {"{": 1, "}": -1}.get(cfg[j], 0)
        if depth == 0:
            return cfg[m.start():j + 1], m.start()
    return None, -1


def check_cfg(cfg):
    failures = []
    entry, entry_at = block(cfg, r'^\s*menuentry "Awai PC \(AMD Radeon, Mesa graphics\)" --id android-awai-pc-amd-mesa ')
    if entry is None:
        failures.append("no Radeon menu entry with id android-awai-pc-amd-mesa")
    else:
        if f'set_android_default "{RADEON_ID}"' not in entry:
            failures.append("the Radeon entry does not save its own id as the default")
        boot = re.search(r"^\s*boot_android (.*)$", entry, re.MULTILINE)
        if not boot or any(a not in boot[1].split() for a in RADEON_ARGS):
            failures.append(f"the Radeon entry does not boot with {' '.join(RADEON_ARGS)}")
    stock = cfg.find("set default=$grub_android_default")
    if stock < 0:
        failures.append("no stock default from grub_android_default")
    detect, detect_at = block(cfg, r'^if \[ "\$default" = "0" \]; then$')
    if detect is None:
        failures.append("no AMD detection block keyed on the factory default 0")
    else:
        if detect_at < max(stock, entry_at):
            failures.append("the detection block runs before the stock default or the Radeon entry is defined")
        for needed in ("insmod setpci", "setpci -d 1af4:1050 -v awai_virtio_gpu VENDOR_ID",
                       "setpci -d 1002: -v awai_amd_class CLASS_DEVICE",
                       'if [ -z "$awai_virtio_gpu" ]; then',
                       "regexp '^3[0-9a-f][0-9a-f]$' \"$awai_amd_class\"",
                       f'set default="{RADEON_ID}"'):
            if needed not in detect:
                failures.append(f"detection block lacks: {needed}")
        guard, choice = detect.find('if [ -z "$awai_virtio_gpu" ]'), detect.find(f'set default="{RADEON_ID}"')
        if guard >= 0 and choice >= 0 and choice < guard:
            failures.append("the Radeon default is set outside the no-virtio-GPU condition")
    return failures


def expected(env, detects):
    value = env.get("grub_android_default", "0") or "0"
    if value == "0" and not detects:
        return value, "first entry (virtio GPU path) on every machine"
    if value == "0":
        return value, "Radeon entry on an AMD GPU without a virtio GPU; first entry (virtio GPU path) otherwise"
    return value, f"saved entry {value} on every machine"


def report(cfg_failures, env, env_failures):
    detects = not any(f.startswith(("no AMD detection", "detection block")) for f in cfg_failures)
    value, selection = expected(env, detects) if env is not None else (None, None)
    record = {"schema": "awai.pc.boot-default.check.v1", "cfgFailures": cfg_failures,
              "grubAndroidDefault": value, "expectedSelection": selection, "envFailures": env_failures,
              "ok": not cfg_failures and not env_failures}
    print(json.dumps(record, indent=2))
    return 0 if record["ok"] else 1


def main():
    a = sys.argv[1:]
    if len(a) != 2 or a[0] not in ("cfg", "env", "image"):
        sys.exit(__doc__)
    if a[0] == "cfg":
        return report(check_cfg(Path(a[1]).read_text()), None, [])
    if a[0] == "env":
        print(json.dumps(parse_env(Path(a[1]).read_bytes()), indent=2))
        return 0
    parts = gpt(a[1])
    env_failures = []
    for name in ("EFI", "persist"):
        if name not in parts and not (name == "EFI" and "awai_esp" in parts):
            sys.exit(f"{a[1]}: no {name} partition")
    esp = parts.get("EFI") or parts["awai_esp"]
    cfg = mcopy(a[1], esp[0], "::/boot/grub/grub.cfg").decode()
    env = parse_env(mcopy(a[1], parts["persist"][0], "::/grubenv"))
    if env.get("grub_android_default", "0") not in ("0", ""):
        env_failures.append(f"a new disk should hold the factory default 0, not {env['grub_android_default']}")
    return report(check_cfg(cfg), env, env_failures)


if __name__ == "__main__":
    sys.exit(main())
