#!/usr/bin/env python3
"""Make web/noto-jp.woff2 (development tool; needs `pip install fonttools brotli`, not used at install time).

  build_font.py NotoSansJP[wght].ttf OFL.txt

Checks both inputs against font-pin.json, limits the weight axis to 400..700 (the CSS uses 400/500/700), keeps
exactly the characters the installer can show (ASCII, Latin-1, general punctuation, CJK punctuation, hiragana,
katakana, full-width ASCII, plus every character in the page, the script and the Japanese messages), writes
WOFF2, the OFL text unchanged, and glyphs-noto-jp.json (the cmap, tied to the font's SHA-256).
OFL 1.1: modified versions must not use a Reserved Font Name ('Source'); this script refuses a font whose
family/full/PostScript names contain it. The font keeps its OFL licence and copyright notice.
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
INSTALLER = os.path.dirname(HERE)
sys.path.insert(0, INSTALLER)
import glyphs  # noqa: E402

RANGES = [(0x20, 0x7E), (0xA0, 0xFF), (0x2010, 0x2027), (0x3000, 0x303F), (0x3040, 0x309F), (0x30A0, 0x30FF), (0xFF01, 0xFF5E)]


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def main(ttf, ofl):
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
    from fontTools import subset
    pin = json.load(open(os.path.join(HERE, "font-pin.json")))
    if sha(ttf) != pin["ttf_sha256"] or sha(ofl) != pin["ofl_sha256"]:
        sys.exit("input does not match font-pin.json")
    wanted = {ord(c) for c in glyphs.ui_characters(INSTALLER)}
    for a, b in RANGES:
        wanted.update(range(a, b + 1))
    font = TTFont(ttf)
    opts = subset.Options()
    opts.layout_features = ["kern", "palt", "locl", "ccmp"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.glyph_names = False
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=sorted(wanted))
    sub.subset(font)
    font = instancer.instantiateVariableFont(font, {"wght": (400, 700)})
    names = {n.nameID: n.toUnicode() for n in font["name"].names if n.nameID in (1, 2, 4, 6, 16, 17)}
    if any("Source" in v for v in names.values()):
        sys.exit(f"font names contain the Reserved Font Name 'Source': {names}")
    out = os.path.join(INSTALLER, "web", "noto-jp.woff2")
    font.flavor = "woff2"
    font.save(out)
    with open(os.path.join(INSTALLER, "web", "font-OFL.txt"), "wb") as f:
        f.write(open(ofl, "rb").read())
    cmap = set(TTFont(out).getBestCmap())
    json.dump({"fontSha256": sha(out), "count": len(cmap), "codepoints": sorted(cmap)}, open(os.path.join(INSTALLER, "glyphs-noto-jp.json"), "w"))
    required = {ord(c) for c in glyphs.ui_characters(INSTALLER)} | set(range(0x20, 0x7F))
    missing = sorted(c for c in required if c not in cmap)  # the ranges above include unassigned codepoints; these must all exist
    print(f"wrote {out} ({os.path.getsize(out)} bytes), {len(cmap)} codepoints; required {len(required)}; missing {len(missing)}: {[hex(m) for m in missing]}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
