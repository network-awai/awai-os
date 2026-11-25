#!/usr/bin/env python3
"""AWAI-4089 (G2): compare a produced manifest's revisions with the pinned one.

Usage: python3 check-manifest-revisions.py <pinned> <produced>

Both manifests are keyed by `path or name` (repo manifest -r omits
`path` when it equals `name`, for 44 projects). The expected set is
the pinned manifest with the same rule the produced manifest has:
projects whose groups contain `notdefault` are excluded (3 darwin
projects are in pinned but not synced by default).
Fails (exit 1, AWAI4089_MANIFEST_MISMATCH) if the maps differ in any
entry; otherwise prints AWAI4089_MANIFEST_COMPARE_OK and exits 0.
"""
import sys
import xml.etree.ElementTree as ET


def load(path, exclude_notdefault=False):
    root = ET.parse(path).getroot()
    out = {}
    for p in root.iter("project"):
        groups = p.get("groups") or ""
        if exclude_notdefault and "notdefault" in groups:
            continue
        out[p.get("path") or p.get("name")] = p.get("revision")
    return out


def main():
    if len(sys.argv) != 3:
        print("usage: check-manifest-revisions.py <pinned> <produced>", file=sys.stderr)
        return 2
    pinned = load(sys.argv[1], exclude_notdefault=True)
    produced = load(sys.argv[2], exclude_notdefault=True)
    diffs = []
    for key in sorted(set(pinned) | set(produced)):
        if pinned.get(key) != produced.get(key):
            diffs.append((key, pinned.get(key), produced.get(key)))
    if diffs:
        for key, want, got in diffs:
            print(f"AWAI4089_MANIFEST_MISMATCH {key}: pinned={want} produced={got}", file=sys.stderr)
        return 1
    print(f"AWAI4089_MANIFEST_COMPARE_OK projects={len(pinned)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
