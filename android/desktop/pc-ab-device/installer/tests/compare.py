#!/usr/bin/env python3
"""Side-by-side sheet: the approved design (design/installer.png) next to the implementation, per screen.
Usage: compare.py SCREENSHOT_DIR (needs the 1280x720 shots)"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cdp  # noqa: E402

INSTALLER = Path(__file__).resolve().parent.parent
# crop boxes in the 2500x1229 design image: x, y, w, h
FRAMES = {"1-select-empty": (39, 42, 740, 490), "2-select-chosen": (852, 42, 740, 490), "3-review": (1666, 42, 740, 490),
          "4-installing": (39, 561, 740, 490), "5-done": (852, 561, 740, 490), "6-no-target": (1666, 561, 740, 490)}
LABELS = {"1-select-empty": "1 インストール先を選ぶ", "2-select-chosen": "2 選択済み", "3-review": "3 内容を確認",
          "4-installing": "4 インストール中", "5-done": "5 完了", "6-no-target": "6 インストール先なし"}


def main(shots):
    shots = Path(shots).resolve()
    rows = []
    for key, (x, y, w, h) in FRAMES.items():
        scale = 640 / w
        rows.append(f'<section><h2>{LABELS[key]}</h2><div class="pair"><div class="crop" style="width:640px;height:{int(h * scale)}px;'
                    f'background:url(file://{INSTALLER}/design/installer.png) -{int(x * scale)}px -{int(y * scale)}px / {int(2500 * scale)}px auto"></div>'
                    f'<img src="file://{shots}/1280x720/{key}.png" width="{int(1280 * 640 / 1280 * 1.0)}" style="margin-left:16px"></div></section>')
    html = ('<meta charset="utf-8"><style>body{font:14px sans-serif;margin:16px;background:#fff;width:1330px}h1{font-size:16px}h2{font-size:13px;margin:12px 0 4px}'
            '.pair{display:flex}.crop{border:1px solid #ccc}img{border:1px solid #ccc}</style>'
            '<h1>左: 承認済みデザイン (installer.png) / 右: 実装 1280x720</h1>' + "".join(rows))
    page = Path(tempfile.mkdtemp()) / "compare.html"
    page.write_text(html)
    b = cdp.Browser(1370, 3000)
    try:
        b.goto(f"file://{page}")
        height = b.eval("document.body.scrollHeight + 32")
        b.call("Emulation.setDeviceMetricsOverride", width=1370, height=height, deviceScaleFactor=1, mobile=False)
        b.shot(str(shots / "compare-design-vs-implementation.png"))
    finally:
        b.close()


if __name__ == "__main__":
    main(sys.argv[1])
