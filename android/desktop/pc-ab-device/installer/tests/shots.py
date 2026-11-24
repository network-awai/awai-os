#!/usr/bin/env python3
"""Screenshots of every screen at 1280x720 and 1920x1080, driven by the keyboard only, against the real
backend with fake tools. Usage: shots.py OUTDIR"""
import fcntl
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cdp  # noqa: E402
import fakes  # noqa: E402
from fakes import core  # noqa: E402
from scenario import Live  # noqa: E402

SIZES = [(1280, 720), (1920, 1080)]


def hold_running(live, step, fraction):
    """A fixture for the mid-progress screen: a state file plus a live lock, as a running worker would leave."""
    work = live.w.work
    (work / "state.json").write_text(json.dumps({"schema": 1, "state": "running", "device": "nvme0n1", "step": step, "fraction": fraction,
                                                 "written": "started", "partitions": 11}))
    (work / "write-started").write_text("")
    fd = os.open(work / "lock", os.O_RDWR | os.O_CREAT, 0o600)
    fcntl.flock(fd, fcntl.LOCK_EX)
    return fd


FONT_LOG = []


def snap(b, path, fonts_log=None):
    """Screenshot plus proof of which font drew the page: every glyph must come from the bundled face."""
    b.shot(path)
    used, faces = b.fonts_used()
    FONT_LOG.append(f"{Path(path).parent.name}/{Path(path).name}: {faces} " + ", ".join(f"{fam!r} custom={c} glyphs={n}" for (fam, c), n in sorted(used.items())))
    assert used and all(custom for (_f, custom) in used), f"system font used in {path}: {used}"
    assert "loaded" in faces, faces


def keyboard_flow(b, live, out, log, prefix=""):
    def note(action):
        log.append(f"{action:<34} focus={b.focused()!r}")
    b.goto(live.url)
    b.wait_text("選択可能")
    snap(b, f"{out}/1-select-empty.png")
    note("load (nothing selected)")
    b.key("Tab"); note("Tab")
    b.key("Enter"); note("Enter  -> select the SSD")
    snap(b, f"{out}/2-select-chosen.png")
    b.key("Tab"); note("Tab")
    b.key("Tab"); note("Tab")
    b.key("Enter"); note("Enter  -> 内容を確認")
    b.wait_text("インストール内容を確認")
    b.type("nvme0"); note("type nvme0 (button still disabled)")
    snap(b, f"{out}/3a-review-typed-partial.png")
    b.type("n1"); note("type n1")
    snap(b, f"{out}/3-review.png")
    b.key("Tab"); note("Tab")
    b.key("Tab"); note("Tab")
    b.key("Enter"); note("Enter  -> この SSD にインストール")
    b.wait_text("インストールしています")
    snap(b, f"{out}/4a-installing-real-start.png")
    b.wait_text("インストールが完了しました")
    snap(b, f"{out}/5-done.png")
    note("done")


def main(outdir):
    outdir = Path(outdir)
    log = []
    for (w, h) in SIZES:
        out = outdir / f"{w}x{h}"
        out.mkdir(parents=True, exist_ok=True)
        # 1,2,3,4a,5: the keyboard-only happy path
        live = Live()
        live.w.update(sgdisk_new_delay=1.0)
        b = cdp.Browser(w, h)
        try:
            keyboard_flow(b, live, str(out), log if (w, h) == SIZES[0] else [])
        finally:
            b.close(); live.close()
        # 4: mid-progress fixture
        live = Live()
        fd = hold_running(live, 2, 0.42)
        b = cdp.Browser(w, h)
        try:
            b.goto(live.url)
            b.wait_text("進行中")
            snap(b, f"{out}/4-installing.png")
        finally:
            b.close(); os.close(fd); live.close()
        # 6: no eligible disk (the only NVMe already has partitions)
        live = Live()
        live.w.edit_disk("nvme0n1", children=[{}])
        b = cdp.Browser(w, h)
        try:
            b.goto(live.url)
            b.wait_text("インストール先が見つかりません")
            snap(b, f"{out}/6-no-target.png")
        finally:
            b.close(); live.close()
        # 7a / 7b: failure before and after writing began
        for name, setup in (("7a-failed-nothing-written", lambda lv: (lv.w.media / "archive.sha256").write_text("0" * 64 + f"  {core.ARCHIVE_NAME}\n")),
                            ("7b-failed-after-write", lambda lv: lv.w.update(sgdisk_v_problem=True))):
            live = Live()
            setup(live)
            b = cdp.Browser(w, h)
            try:
                b.goto(live.url)
                b.wait_text("選択可能")
                for k in ("Tab", "Enter", "Tab", "Tab", "Enter"):
                    b.key(k)
                b.wait_text("インストール内容を確認")
                b.type("nvme0n1")
                for k in ("Tab", "Tab", "Enter"):
                    b.key(k)
                b.wait_text("インストールできませんでした")
                snap(b, f"{out}/{name}.png")
                if (w, h) == SIZES[0]:
                    log.append(f"[{name}] page text: " + " | ".join(l for l in b.text().splitlines() if l.strip())[:300])
            finally:
                b.close(); live.close()
    (outdir / "fonts-used.txt").write_text("\n".join(FONT_LOG) + "\n")
    (outdir / "keyboard-walkthrough.txt").write_text("\n".join(log) + "\n")


if __name__ == "__main__":
    main(sys.argv[1])
