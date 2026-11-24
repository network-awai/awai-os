#!/usr/bin/env python3
"""Screenshots of every screen at 1280x720 and 1920x1080 from the real GTK widget tree (offscreen: nothing is shown on a display),
driven with simulated Tab/Enter/typing, plus the keyboard walkthrough, the font proof, and the side-by-side sheet with the design.
Usage: shots.py OUTDIR   (needs PyGObject + Gtk 3)"""
import fcntl
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fakes  # noqa: E402
from fakes import core  # noqa: E402
import gtkdrive  # noqa: E402

SIZES = [(1280, 720), (1920, 1080)]
INSTALLER = Path(__file__).resolve().parent.parent
FONT_LOG = []


def snap(d, path):
    d.snap(path)
    used = d.fonts_used()
    FONT_LOG.append(f"{Path(path).parent.name}/{Path(path).name}: " + ", ".join(f"{fam!r} bundled-face-exact={ok} glyphs={n}" for (fam, ok), n in sorted(used.items())))
    assert used and all(ok and fam == "Noto Sans JP" for (fam, ok) in used), f"a glyph is not drawn by the bundled face in {path}: {used}"


def hold_running(d, step, fraction):
    work = d.w.work
    (work / "state.json").write_text(json.dumps({"schema": 1, "state": "running", "device": "nvme0n1", "step": step, "fraction": fraction, "written": "started", "partitions": 11}))
    (work / "write-started").write_text("")
    fd = os.open(work / "lock", os.O_RDWR | os.O_CREAT, 0o600)
    fcntl.flock(fd, fcntl.LOCK_EX)
    return fd


def pick_and_type(d, name="nvme0n1"):
    for k in ("Tab", "Enter", "Tab", "Enter"):
        d.key(k)
    d.type(name)


def main(outdir):
    out_root = Path(outdir)
    log = []
    for (w, h) in SIZES:
        out = out_root / f"{w}x{h}"
        out.mkdir(parents=True, exist_ok=True)
        note = (lambda s, d=None: None)
        # 1,2,3,4a,5: the keyboard-only happy path
        d = gtkdrive.Drive(w, h)
        d.w.update(sgdisk_new_delay=1.0)
        first = (w, h) == SIZES[0]
        n = (lambda a: log.append(f"{a:<40} focus={d.focus_text()!r}")) if first else (lambda a: None)
        try:
            snap(d, out / "1-select-empty.png"); n("start (nothing selected, nothing focused)")
            d.key("Tab"); n("Tab")
            d.key("Enter"); n("Enter  -> select the SSD")
            snap(d, out / "2-select-chosen.png")
            d.key("Tab"); n("Tab  (first stop: 内容を確認)")
            d.key("Enter"); n("Enter  -> 内容を確認")
            d.type("nvme0"); n("type nvme0 (button still disabled)")
            snap(d, out / "3a-review-typed-partial.png")
            d.type("n1"); n("type n1")
            snap(d, out / "3-review.png")
            d.key("Tab"); n("Tab  (first stop: この SSD にインストール)")
            d.key("Enter"); n("Enter  -> この SSD にインストール")
            snap(d, out / "4a-installing-real-start.png")
            end = time.time() + 90
            while time.time() < end and "インストールが完了しました" not in d.text():
                time.sleep(0.3)
                d.poll()
            snap(d, out / "5-done.png"); n("done")
        finally:
            d.close()
        # 4: mid-progress fixture (a state file plus a live lock, as a running worker leaves them)
        d = gtkdrive.Drive(w, h)
        fd = hold_running(d, 2, 0.42)
        try:
            d.poll()
            snap(d, out / "4-installing.png")
        finally:
            os.close(fd)
            d.close()
        # 6: no eligible disk
        d = gtkdrive.Drive(w, h)
        try:
            d.w.edit_disk("nvme0n1", children=[{}])
            d.c.refresh()
            d.ui.render(force=True)
            snap(d, out / "6-no-target.png")
        finally:
            d.close()
        # 7a / 7b: failure before and after writing began
        for name, setup in (("7a-failed-nothing-written", lambda x: (x.w.media / "archive.sha256").write_text("0" * 64 + f"  {core.ARCHIVE_NAME}\n")),
                            ("7b-failed-after-write", lambda x: x.w.update(sgdisk_v_problem=True))):
            d = gtkdrive.Drive(w, h)
            try:
                setup(d)
                pick_and_type(d)
                d.key("Tab")
                d.key("Enter")
                end = time.time() + 90
                while time.time() < end and "インストールできませんでした" not in d.text():
                    time.sleep(0.3)
                    d.poll()
                snap(d, out / f"{name}.png")
                if first:
                    log.append(f"[{name}] text: " + " | ".join(t for t in d.text().splitlines() if t.strip())[:300])
            finally:
                d.close()
    (out_root / "fonts-used.txt").write_text("\n".join(FONT_LOG) + "\n")
    (out_root / "keyboard-walkthrough.txt").write_text("\n".join(log) + "\n")
    compare(out_root)


def compare(out_root):
    """Side-by-side sheet: design crops (design/installer.png) left, the 1280x720 screens right."""
    import gi
    gi.require_version("GdkPixbuf", "2.0")
    from gi.repository import GdkPixbuf
    design = GdkPixbuf.Pixbuf.new_from_file(str(INSTALLER / "design" / "installer.png"))
    frames = [("1-select-empty", 39, 42), ("2-select-chosen", 852, 42), ("3-review", 1666, 42), ("4-installing", 39, 561), ("5-done", 852, 561), ("6-no-target", 1666, 561)]
    cw = 640
    ch = round(490 * cw / 740)
    sheet = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, True, 8, cw * 2 + 48, len(frames) * (ch + 16) + 16)
    sheet.fill(0xFFFFFFFF)
    for i, (name, x, y) in enumerate(frames):
        left = GdkPixbuf.Pixbuf.new_subpixbuf(design, x, y, 740, 490).scale_simple(cw, ch, GdkPixbuf.InterpType.BILINEAR)
        right = GdkPixbuf.Pixbuf.new_from_file(str(out_root / "1280x720" / f"{name}.png")).scale_simple(cw, round(720 * cw / 1280), GdkPixbuf.InterpType.BILINEAR)
        top = 16 + i * (ch + 16)
        left.copy_area(0, 0, cw, ch, sheet, 16, top)
        right.copy_area(0, 0, cw, right.get_height(), sheet, 32 + cw, top)
    sheet.savev(str(out_root / "compare-design-vs-implementation.png"), "png", [], [])


if __name__ == "__main__":
    main(sys.argv[1])
