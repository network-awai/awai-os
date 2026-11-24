#!/usr/bin/env python3
"""Assemble the Awai OS PC installer USB image: stock SystemRescue ISO + overlay -> new ISO. Downloads nothing.

  build-overlay.py --stock-iso ISO --stock-iso-sha256 SHA --image-zst awai-pc-install.img.zst \\
      --archive-sha256 SHA --image-sha256 SHA --out awai-os-pc-usb-installer.iso [--dry-run]

--archive-sha256 is the digest of the .zst, --image-sha256 of the raw image inside it (both come from the
signing / build record). The script checks the stock ISO digest, the archive digest and (streaming through
zstd) the raw digest, then writes the two pin files the installer reads, copies the installer, and runs
xorriso the way the previous USB build did (`-boot_image any replay`, /awai and /sysrescue.d added).
--dry-run does every check and builds the overlay directory, but does not call xorriso or write --out.
"""
import argparse
import hashlib
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import glyphs  # noqa: E402

PC_AB = os.path.dirname(HERE)
REPO_FONT = os.path.join(HERE, "fonts", "NotoSansJP-Regular.ttf")
SHA = re.compile(r"[0-9a-f]{64}")
# boot menus replaced in the image (GRUB for UEFI, syslinux for BIOS); kernel/initrd lines are the stock ones
BOOT_FILES = [("boot/grub/grubsrcd.cfg", "grubsrcd.cfg"), ("boot/syslinux/sysresccd_head.cfg", "sysresccd_head.cfg"),
              ("boot/syslinux/sysresccd_sys.cfg", "sysresccd_sys.cfg")]
INSTALLER_FILES = ["core.py", "controller.py", "gui.py", "keys.py", "strings.py", "text_installer.py", "start.sh", "xsession.sh"]


class BuildError(SystemExit):
    pass


def fail(msg):
    raise BuildError(f"build-overlay: {msg}")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(8 << 20):
            h.update(chunk)
    return h.hexdigest()


def raw_digest(zst):
    proc = subprocess.Popen(["zstd", "--quiet", "-dc", "--", zst], stdout=subprocess.PIPE)
    h = hashlib.sha256()
    while chunk := proc.stdout.read(8 << 20):
        h.update(chunk)
    proc.stdout.close()
    if proc.wait() != 0:
        fail("zstd could not decompress the image")
    return h.hexdigest()


def build_overlay(args, overlay):
    awai = os.path.join(overlay, "awai")
    inst = os.path.join(awai, "installer")
    os.makedirs(inst)
    os.makedirs(os.path.join(overlay, "sysrescue.d"))
    shutil.copy(os.path.join(PC_AB, "awai-pc-install.py"), awai)  # canonical copy, never an edited one
    shutil.copy(os.path.join(HERE, "awai-install"), os.path.join(awai, "install"))
    for name in INSTALLER_FILES:
        shutil.copy(os.path.join(HERE, name), inst)
    for folder in ("fonts", "assets"):
        shutil.copytree(os.path.join(HERE, folder), os.path.join(inst, folder))
    shutil.copy(os.path.join(HERE, "700-awai-installer.yaml"), os.path.join(overlay, "sysrescue.d"))
    for target, name in BOOT_FILES:
        os.makedirs(os.path.join(overlay, os.path.dirname(target)), exist_ok=True)
        shutil.copy(os.path.join(HERE, "boot", name), os.path.join(overlay, target))
    with open(os.path.join(awai, "archive.sha256"), "w") as f:
        f.write(f"{args.archive_sha256}  awai-pc-install.img.zst\n")
    with open(os.path.join(awai, "install-image.sha256"), "w") as f:
        f.write(f"{args.image_sha256}  awai-pc-install.img\n")
    for root, _dirs, files in os.walk(overlay):
        for name in files:
            p = os.path.join(root, name)
            os.chmod(p, 0o755 if name in ("install", "start.sh", "xsession.sh") else 0o644)


def xorriso_command(args, overlay):
    return ["xorriso", "-indev", args.stock_iso, "-outdev", args.out, "-boot_image", "any", "replay", "-overwrite", "on",
            "-map", os.path.join(overlay, "awai"), "/awai",
            "-map", os.path.join(overlay, "sysrescue.d", "700-awai-installer.yaml"), "/sysrescue.d/700-awai-installer.yaml",
            *[arg for target, _ in BOOT_FILES for arg in ("-map", os.path.join(overlay, target), "/" + target)],
            "-map", args.image_zst, "/awai/awai-pc-install.img.zst", "-commit"]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stock-iso", required=True)
    ap.add_argument("--stock-iso-sha256", required=True)
    ap.add_argument("--image-zst", required=True)
    ap.add_argument("--archive-sha256", required=True)
    ap.add_argument("--image-sha256", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--keep-overlay", help="build the overlay in this new directory and keep it")
    args = ap.parse_args(argv)

    for name in ("stock_iso_sha256", "archive_sha256", "image_sha256"):
        if not SHA.fullmatch(getattr(args, name)):
            fail(f"--{name.replace('_', '-')} must be a lowercase SHA-256 digest")
    for p in (args.stock_iso, args.image_zst):
        if not os.path.isfile(p):
            fail(f"{p}: no such file")
    if os.path.lexists(args.out):
        fail(f"{args.out}: output already exists; choose a new path")
    if sha256_file(args.stock_iso) != args.stock_iso_sha256:
        fail("stock ISO digest does not match --stock-iso-sha256")
    if sha256_file(args.image_zst) != args.archive_sha256:
        fail("image archive digest does not match --archive-sha256")
    if raw_digest(args.image_zst) != args.image_sha256:
        fail("decompressed image digest does not match --image-sha256")

    # The live system has no other Japanese font: a missing glyph is a hard failure, with no override.
    try:
        coverage = glyphs.font_coverage(REPO_FONT, HERE)
    except (ValueError, OSError, KeyError) as e:
        fail(f"cannot read the bundled font's glyph list: {e}")
    missing = sorted(c for c in glyphs.required_codepoints(HERE) if c not in coverage)
    if missing:
        fail(f"the bundled font has no glyph for {len(missing)} installer characters ({''.join(map(chr, missing))}); "
             "rebuild it with font/build_font.py")

    parent = args.keep_overlay
    if parent:
        os.makedirs(parent)
        overlay = parent
    else:
        overlay = tempfile.mkdtemp(prefix="awai-overlay-")
    try:
        build_overlay(args, overlay)
        cmd = xorriso_command(args, overlay)
        print("overlay:", overlay)
        print("xorriso:", " ".join(shlex.quote(c) for c in cmd))
        if args.dry_run:
            print("dry run: xorriso not called, nothing written")
            return 0
        if shutil.which("xorriso") is None:
            fail("xorriso not found")
        return subprocess.run(cmd).returncode
    finally:
        if not parent:
            shutil.rmtree(overlay, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
