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

SIZES = [tuple(int(v) for v in p.split("x")) for p in os.environ.get("AWAI_SHOT_SIZES", "1280x720,1920x1080,1024x768,1366x768,1080x1920,800x600").split(",")]
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


def pick_and_start(d):
    """Keyboard only: the single SSD is already chosen. Enter -> review, Enter -> confirmation, → インストールする, Enter."""
    for k in ("Enter", "Enter", "Right", "Enter"):
        d.key(k)


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
            snap(d, out / "1-select-boot.png"); n("start (one SSD: chosen, focus on 内容を確認)")
            d.key("Enter"); n("Enter  -> review (focus on この SSD にインストール)")
            snap(d, out / "3-review.png")
            d.key("Enter"); n("Enter  -> confirmation (focus on やめる)")
            snap(d, out / "3b-confirm.png")
            d.key("Right"); n("Right  -> インストールする")
            snap(d, out / "3c-confirm-go-focused.png")
            d.key("Enter"); n("Enter  -> install starts")
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
        # 2: two empty SSDs (the board's screen 2)
        wt = fakes.World()
        wt.world["disks"]["nvme1n1"] = fakes.disk(size=int(953.9 * 2 ** 30), model="KBG50Z", serial="XXXX90F2")
        wt.world["disks"]["nvme0n1"].update(model="YXF800E3", serial="XXXX4C1A", size=int(238.5 * 2 ** 30))
        (wt.dev / "nvme1n1").write_bytes(b"")
        wt.save()
        d = gtkdrive.Drive(w, h, world=wt)
        try:
            snap(d, out / "2-select-two.png")
        finally:
            d.close()
        # 2b: several SSDs (the list scrolls) and the longest names
        import layoutcheck
        wd = fakes.World()
        layoutcheck.add_disks(wd, 8)
        d = gtkdrive.Drive(w, h, world=wd)
        try:
            snap(d, out / "2-select-eight-ssds.png")
            for _ in range(7):
                d.key("Down")
            snap(d, out / "2b-select-eight-last-focused.png")
            d.key("Enter")
            d.key("Enter")
            d.key("Enter")
            snap(d, out / "3d-confirm-long-names.png")
        finally:
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
                pick_and_start(d)
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
    """Side-by-side sheet: the Figma board's screens (design/installer-rev2.png) left, the 1280x720 screens right."""
    import gi
    gi.require_version("GdkPixbuf", "2.0")
    from gi.repository import GdkPixbuf
    design = GdkPixbuf.Pixbuf.new_from_file(str(INSTALLER / "design" / "installer-rev2.png"))
    # (our screenshot, board screen origin): board screens sit at (60 + 1360 * col, 120 + 820 * row) and are 1280x720
    frames = [("1-select-boot", 0, 0), ("2-select-two", 1, 0), ("3-review", 2, 0), ("3b-confirm", 0, 1), ("4-installing", 1, 1),
              ("5-done", 2, 1), ("6-no-target", 0, 2), ("7a-failed-nothing-written", 1, 2)]
    cw, ch = 640, 360
    sheet = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, True, 8, cw * 2 + 48, len(frames) * (ch + 16) + 16)
    sheet.fill(0xFFFFFFFF)
    for i, (name, col, row) in enumerate(frames):
        left = GdkPixbuf.Pixbuf.new_subpixbuf(design, 60 + 1360 * col, 120 + 820 * row, 1280, 720).scale_simple(cw, ch, GdkPixbuf.InterpType.BILINEAR)
        right = GdkPixbuf.Pixbuf.new_from_file(str(out_root / "1280x720" / f"{name}.png")).scale_simple(cw, ch, GdkPixbuf.InterpType.BILINEAR)
        top = 16 + i * (ch + 16)
        left.copy_area(0, 0, cw, ch, sheet, 16, top)
        right.copy_area(0, 0, cw, ch, sheet, 32 + cw, top)
    sheet.savev(str(out_root / "compare-design-vs-implementation.png"), "png", [], [])


if __name__ == "__main__":
    main(sys.argv[1])
