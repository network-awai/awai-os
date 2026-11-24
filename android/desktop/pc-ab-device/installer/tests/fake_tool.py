#!/usr/bin/env python3
"""Fake lsblk/blockdev/wipefs/findmnt/sgdisk/zstd/sync/systemctl for tests. Reads FAKE_WORLD (a JSON file).
Invoked as `fake_tool.py NAME ARGS...` by the one-line wrappers fakes.py writes into a bin directory."""
import hashlib, json, os, re, sys, time

SECTOR = 512
W = os.environ["FAKE_WORLD"]


def world():
    with open(W) as f:
        return json.load(f)


def save(w):
    with open(W + ".tmp", "w") as f:
        json.dump(w, f)
    os.replace(W + ".tmp", W)


def fail(msg, rc=1):
    print(msg, file=sys.stderr)
    sys.exit(rc)


def disk_for(w, arg):
    d = w["disks"].get(os.path.basename(arg))
    if d is None:
        fail(f"{arg}: not a block device", 32)
    return os.path.basename(arg), d


def lsblk(a, w):
    cols = a[a.index("-o") + 1].split(",")
    path = a[-1] if not a[-1].startswith("-") and a[-1] != a[a.index("-o") + 1] else None
    if "-s" in a:
        src = os.path.basename(path)
        for line in w["boot"]["chain"] if w.get("boot") else []:
            print(line)
        return
    if "-P" in a:
        names = [os.path.basename(path)] if path else list(w["disks"])
        for n in names:
            if n not in w["disks"]:
                fail(f"{path}: not a block device", 32)
            d = w["disks"][n]
            vals = {"NAME": n, "SIZE": d["size"], "MODEL": d.get("model", ""), "SERIAL": d.get("serial") or "",
                    "WWN": d.get("wwn") or "", "TRAN": d.get("tran", ""), "RO": d.get("ro", "0"),
                    "TYPE": d.get("type", "disk"), "MAJ:MIN": d.get("majmin", "259:0")}
            print(" ".join(f'{c}="{vals[c]}"' for c in cols))
        return
    n, d = disk_for(w, path)
    if cols == ["TYPE", "RO"]:
        print(d.get("type", "disk"), d.get("ro", "0"))
    elif cols == ["TYPE"]:
        print(d.get("type", "disk"))
        for _ in d.get("children", []):
            print("part")
    elif cols == ["MOUNTPOINTS"]:
        print("\n".join(d.get("mounts", [""]) + [m for c in d.get("children", []) for m in [c.get("mount", "")]]))
    else:
        fail("unsupported lsblk call " + " ".join(a), 2)


def load_gpt(path):
    side = path + ".gpt.json"
    if os.path.exists(side):
        return json.load(open(side))
    with open(path, "rb") as f:
        head = f.read(1 << 16)
    if head.startswith(b"FAKEGPT"):
        return json.loads(head[7:].split(b"\0")[0])
    return {"parts": [], "guids": {}}


def sgdisk(a, w):
    if a[0] == "-p":
        path = a[1]
        g = load_gpt(path)
        sectors = os.path.getsize(path) // SECTOR
        print(f"Disk {path}: {sectors} sectors")
        print(f"Sector size (logical/physical): {w.get('sgdisk_logical', 512)}/512 bytes")
        print(f"First usable sector is 34, last usable sector is {sectors - 34}")
        print("\nNumber  Start (sector)    End (sector)  Size       Code  Name")
        for p in g["parts"]:
            print(f"{p['number']:>4} {p['start']:>14} {p['end']:>14}   {(p['end']-p['start']+1)//2} KiB   {p['type'].upper():<5} {p['name']}")
    elif a[0].startswith("-i"):
        g = load_gpt(a[1])
        n = int(a[0][2:])
        print(f"Partition unique GUID: {g['guids'].get(str(n), '00000000-0000-0000-0000-000000000000').upper()}")
    elif a[0] == "-v":
        if w.get("sgdisk_v_problem"):
            print("Problem: overlapping partitions")
        else:
            print("No problems found. 0 free sectors (0 bytes) available in 0 segments")
        sys.exit(w.get("sgdisk_v_rc", 0))
    elif a[0].startswith("--new="):
        path = a[-1]
        g = load_gpt(path)
        n, s, e = a[0].split("=")[1].split(":")
        part = {"number": int(n), "start": int(s), "end": int(e), "type": "8300", "name": ""}
        for x in a[1:-1]:
            if x.startswith("--typecode="):
                part["type"] = x.split(":")[1]
            elif x.startswith("--change-name="):
                part["name"] = x.split(":", 1)[1]
            elif x.startswith("--partition-guid="):
                g["guids"][n] = x.split(":", 1)[1]
        if w.get("sgdisk_new_fail"):
            fail("sgdisk: simulated failure", 4)
        if not g["parts"] and w.get("sgdisk_new_delay"):
            time.sleep(w["sgdisk_new_delay"])
        g["parts"].append(part)
        json.dump(g, open(path + ".gpt.json", "w"))
    else:
        fail("unsupported sgdisk call " + " ".join(a), 2)


def main():
    tool, a = sys.argv[1], sys.argv[2:]
    w = world()
    if tool == "lsblk":
        lsblk(a, w)
    elif tool == "blockdev":
        print(disk_for(w, a[-1])[1].get("logsec", 512))
    elif tool == "wipefs":
        print("\n".join(disk_for(w, a[-1])[1].get("signatures", [])))
    elif tool == "findmnt":
        if not w.get("boot"):
            sys.exit(1)
        print(w["boot"]["source"])
    elif tool == "sgdisk":
        sgdisk(a, w)
    elif tool == "zstd":
        data = sys.stdin.buffer.read()
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
        for name, fields in (w.get("mutate_after_zstd") or {}).items():
            w["disks"][name].update(fields)
            save(w)
    elif tool == "sync":
        sys.exit(w.get("sync_rc", 0))
    elif tool == "systemctl":
        w.setdefault("power_calls", []).append(a)
        save(w)
    else:
        fail("unknown fake " + tool, 127)


main()
