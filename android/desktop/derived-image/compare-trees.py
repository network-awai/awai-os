#!/usr/bin/env python3
"""Compare two mounted filesystem trees: type, mode, owner, xattrs and content or link target.

Prints JSON with added, removed and changed paths. Used to prove a derived image differs from
its base only where intended.
"""
import hashlib, json, os, stat, sys


def entry(root, rel):
    path = os.path.join(root, rel) if rel else root
    st = os.lstat(path)
    xattrs = {}
    for name in sorted(os.listxattr(path, follow_symlinks=False)):
        xattrs[name] = os.getxattr(path, name, follow_symlinks=False).hex()
    item = {"mode": oct(st.st_mode), "uid": st.st_uid, "gid": st.st_gid, "xattrs": xattrs}
    if stat.S_ISLNK(st.st_mode):
        item["link"] = os.readlink(path)
    elif stat.S_ISREG(st.st_mode):
        digest = hashlib.sha256()
        with open(path, "rb") as f:
            for block in iter(lambda: f.read(1 << 20), b""):
                digest.update(block)
        item["sha256"] = digest.hexdigest()
    elif stat.S_ISCHR(st.st_mode) or stat.S_ISBLK(st.st_mode):
        item["rdev"] = st.st_rdev
    return item


def walk(root):
    items = {"": entry(root, "")}
    for dirpath, dirnames, filenames in os.walk(root):
        for name in dirnames + filenames:
            rel = os.path.relpath(os.path.join(dirpath, name), root)
            items[rel] = entry(root, rel)
    return items


old, new = walk(sys.argv[1]), walk(sys.argv[2])
result = {
    "entriesBase": len(old),
    "entriesDerived": len(new),
    "added": sorted(set(new) - set(old)),
    "removed": sorted(set(old) - set(new)),
    "changed": sorted(p for p in set(old) & set(new) if old[p] != new[p]),
}
result["changedDetail"] = {p: {k: [old[p].get(k), new[p].get(k)] for k in set(old[p]) | set(new[p]) if old[p].get(k) != new[p].get(k)} for p in result["changed"]}
json.dump(result, sys.stdout, indent=2, sort_keys=True)
print()
