#!/usr/bin/env python3
"""Which characters the bundled Japanese web font can draw.

  glyphs.py generate FONT.woff2 OUT.json   development only: needs the `brotli` command; writes the cmap
  (the live system has no Japanese font, so the page ships this one; tests read the committed JSON)

`coverage_of(json, font)` refuses a JSON that was made from a different font file (SHA-256 recorded).
"""
import hashlib
import json
import struct
import subprocess
import sys

KNOWN_TAGS = ("cmap head hhea hmtx maxp name OS/2 post cvt fpgm glyf loca prep CFF VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx "
              "BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty "
              "just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill").split()


def base128(data, pos):
    value = 0
    for _ in range(5):
        byte = data[pos]
        pos += 1
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            return value, pos
    raise ValueError("bad UIntBase128")


def sfnt_cmap(data):
    """cmap of a plain TrueType/OpenType file or the first font of a collection (no decompression needed)."""
    base = 0
    if data[:4] == b"ttcf":
        base, = struct.unpack(">I", data[12:16])
    num, = struct.unpack(">H", data[base + 4:base + 6])
    for i in range(num):
        tag, _sum, off, length = struct.unpack(">4sIII", data[base + 12 + 16 * i:base + 28 + 16 * i])
        if tag == b"cmap":
            return parse_cmap(data[off:off + length])
    raise ValueError("no cmap")


def cmap_codepoints(woff2_path):
    data = open(woff2_path, "rb").read()
    if data[:4] != b"wOF2":
        return sfnt_cmap(data)
    num_tables, = struct.unpack(">H", data[12:14])
    compressed_size, = struct.unpack(">I", data[20:24])
    pos, tables = 48, []
    for _ in range(num_tables):
        flags = data[pos]
        pos += 1
        tag = KNOWN_TAGS[flags & 0x3F] if (flags & 0x3F) != 63 else data[pos:pos + 4].decode()
        if (flags & 0x3F) == 63:
            pos += 4
        orig, pos = base128(data, pos)
        transformed = (tag in ("glyf", "loca")) != bool(flags >> 6)  # glyf/loca: version 0 = transformed
        length = orig
        if tag in ("glyf", "loca"):
            if (flags >> 6) == 0:
                length, pos = base128(data, pos)
        elif (flags >> 6) != 0:
            length, pos = base128(data, pos)
        tables.append((tag, length))
    blob = subprocess.run(["brotli", "-d", "-c"], input=data[pos:pos + compressed_size], capture_output=True, check=True).stdout
    off = 0
    for tag, length in tables:
        if tag == "cmap":
            return parse_cmap(blob[off:off + length])
        off += length
    raise ValueError("no cmap")


def parse_cmap(t):
    n, = struct.unpack(">H", t[2:4])
    points = set()
    for i in range(n):
        pid, eid, offset = struct.unpack(">HHI", t[4 + 8 * i:12 + 8 * i])
        fmt, = struct.unpack(">H", t[offset:offset + 2])
        if fmt == 4:
            segx2, = struct.unpack(">H", t[offset + 6:offset + 8])
            seg = segx2 // 2
            ends = struct.unpack(f">{seg}H", t[offset + 14:offset + 14 + segx2])
            starts = struct.unpack(f">{seg}H", t[offset + 16 + segx2:offset + 16 + 2 * segx2])
            for s, e in zip(starts, ends):
                points.update(range(s, e + 1)) if e != 0xFFFF else points.update(range(s, 0xFFFF))
        elif fmt == 12:
            groups, = struct.unpack(">I", t[offset + 12:offset + 16])
            for g in range(groups):
                s, e, _g = struct.unpack(">III", t[offset + 16 + 12 * g:offset + 28 + 12 * g])
                points.update(range(s, e + 1))
    return points


def font_coverage(font_path, installer_dir):
    """Codepoints a font file can draw: the committed list for the bundled subset, else read from the file."""
    import os
    committed = os.path.join(installer_dir, "glyphs-noto-jp.json")
    try:
        return coverage_of(committed, font_path)
    except (ValueError, OSError, KeyError):
        return cmap_codepoints(font_path)


def generate(font, out):
    points = sorted(cmap_codepoints(font))
    json.dump({"fontSha256": hashlib.sha256(open(font, "rb").read()).hexdigest(), "count": len(points),
               "codepoints": points}, open(out, "w"))


def coverage_of(json_path, font_path):
    doc = json.load(open(json_path))
    if doc["fontSha256"] != hashlib.sha256(open(font_path, "rb").read()).hexdigest():
        raise ValueError("glyph list was generated from a different font file")
    return set(doc["codepoints"])


if __name__ == "__main__":
    if sys.argv[1:2] == ["generate"]:
        generate(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)


def required_codepoints(installer_dir):
    """Everything the screens can draw from their own copy: ui_characters plus printable ASCII (digits, Latin, punctuation)."""
    return {ord(c) for c in ui_characters(installer_dir)} | set(range(0x20, 0x7F))


def ui_characters(installer_dir):
    """Every character the screen installer can show: page, script, and the Japanese backend messages."""
    import os
    sys.path.insert(0, installer_dir)
    import core
    text = "".join(open(os.path.join(installer_dir, "web", n), encoding="utf-8").read() for n in ("index.html", "app.js"))
    text += "".join(ja for ja, _ in core.MESSAGES.values()) + "".join(core.STEPS_JA.values())
    return {c for c in text if ord(c) > 0x7F}
