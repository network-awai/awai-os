#!/usr/bin/env python3
"""AWAI-4089 (G2): compare a produced manifest's revisions with the pinned one.

Usage: python3 check-manifest-revisions.py <pinned> <produced>

Parses both XML manifests and compares the path -> revision map for
every project. Fails (exit 1, AWAI4089_MANIFEST_MISMATCH) if the maps
differ in any entry; otherwise prints
AWAI4089_MANIFEST_COMPARE_OK with the project count and exits 0.
"""
import sys
import xml.etree.ElementTree as ET


def load(path):
    root = ET.parse(path).getroot()
    out = {}
    for p in root.iter("project"):
        rev = p.get("revision")
        out[p.get("path")] = rev
    return out


def main():
    if len(sys.argv) != 3:
        print("usage: check-manifest-revisions.py <pinned> <produced>", file=sys.stderr)
        return 2
    pinned, produced = (load(sys.argv[1]), load(sys.argv[2]))
    diffs = []
    for path in sorted(set(pinned) | set(produced)):
        if pinned.get(path) != produced.get(path):
            diffs.append((path, pinned.get(path), produced.get(path)))
    if diffs:
        for path, want, got in diffs:
            print(f"AWAI4089_MANIFEST_MISMATCH {path}: pinned={want} produced={got}", file=sys.stderr)
        return 1
    print(f"AWAI4089_MANIFEST_COMPARE_OK projects={len(pinned)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
