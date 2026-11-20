#!/usr/bin/env python3
"""AWAI-3586: add the Awai A/B partitions to a disk that already has partitions, without touching them.

  awai-pc-install.py plan  <target disk or image> <source disk image> [--userdata-gib N]
  awai-pc-install.py apply <target disk or image> <source disk image> [--userdata-gib N] --record out.json

The source is the disk image the build makes (disk-vda.img). Each Awai partition is copied from the
partition of the same name in it. Nothing is written outside the new partitions and the GPT.
`plan` writes nothing. `apply` refuses when a name is already used, when the free space is too small, or
when a planned range overlaps an existing partition, and proves afterwards that every partition that
existed before has the same sha256.
"""
import hashlib, json, os, re, subprocess, sys

SECTOR = 512
ALIGN = 2048
# name on the target, name in the source image (None: created empty), fixed partition GUID or None, type code
LAYOUT = [
    ("awai_esp",      "EFI",           None,                                   "ef00"),
    ("super",         "super",         None,                                   "8300"),
    ("misc",          None,            "41574149-0000-4d49-8000-000000000001", "8300"),
    ("persist",       "persist",       None,                                   "8300"),
    ("metadata",      None,            None,                                   "8300"),
    ("firmware",      "firmware",      None,                                   "8300"),
    ("vendor_boot_a", "vendor_boot_a", "41574149-0000-5642-8000-00000000000a", "8300"),
    ("vendor_boot_b", "vendor_boot_b", "41574149-0000-5642-8000-00000000000b", "8300"),
    ("boot_a",        "boot_a",        "41574149-0000-424f-8000-00000000000a", "8300"),
    ("boot_b",        "boot_b",        "41574149-0000-424f-8000-00000000000b", "8300"),
    ("userdata",      None,            None,                                   "8300"),
]
EMPTY_SECTORS = {"misc": 2048, "metadata": 65536}
RESERVED = {n for n, _, _, _ in LAYOUT} | {"efi", "bios", "cache", "recovery", "boot", "vendor_boot"}


def sgdisk(*a):
    return subprocess.run(["sgdisk", *a], check=True, capture_output=True, text=True).stdout


def table(path):
    out = sgdisk("-p", path)
    parts = []
    for line in out.splitlines():
        m = re.match(r"\s*(\d+)\s+(\d+)\s+(\d+)\s+\S+\s+\S+\s+(\S+)\s*(.*)$", line)
        if m:
            parts.append({"number": int(m[1]), "start": int(m[2]), "end": int(m[3]), "type": m[4], "name": m[5].strip()})
    last = int(re.search(r"last usable sector is (\d+)", out)[1])
    first = int(re.search(r"First usable sector is (\d+)", out)[1])
    return parts, first, last


def sha_range(path, start, end):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        f.seek(start * SECTOR)
        left = (end - start + 1) * SECTOR
        while left:
            b = f.read(min(left, 8 << 20))
            if not b:
                break
            h.update(b)
            left -= len(b)
    return h.hexdigest()


def free_ranges(parts, first, last):
    cur, out = first, []
    for p in sorted(parts, key=lambda p: p["start"]):
        if p["start"] > cur:
            out.append((cur, p["start"] - 1))
        cur = max(cur, p["end"] + 1)
    if cur <= last:
        out.append((cur, last))
    return out


def make_plan(target, source, userdata_gib):
    tparts, tfirst, tlast = table(target)
    sparts, _, _ = table(source)
    src = {p["name"]: p for p in sparts}
    clash = sorted(p["name"] for p in tparts if p["name"].lower() in RESERVED)
    if clash:
        sys.exit(f"REFUSED name-in-use: {clash}")
    need = []
    for name, sname, guid, code in LAYOUT:
        if sname:
            if sname not in src:
                sys.exit(f"REFUSED source-has-no-partition: {sname}")
            sectors = src[sname]["end"] - src[sname]["start"] + 1
        elif name == "userdata":
            sectors = userdata_gib * (1 << 30) // SECTOR
        else:
            sectors = EMPTY_SECTORS[name]
        need.append((name, sname, guid, code, sectors))
    total = sum(-(-n[4] // ALIGN) * ALIGN for n in need)
    best = None
    for a, b in free_ranges(tparts, tfirst, tlast):
        a2 = -(-a // ALIGN) * ALIGN
        if b - a2 + 1 >= total and (best is None or b - a2 > best[1] - best[0]):
            best = (a2, b)
    if best is None:
        sys.exit(f"REFUSED not-enough-free-space: need {total} sectors in one free range, free ranges {free_ranges(tparts, tfirst, tlast)}")
    used = {p["number"] for p in tparts}
    cur, num, new = best[0], 1, []
    for name, sname, guid, code, sectors in need:
        while num in used:
            num += 1
        used.add(num)
        new.append({"number": num, "name": name, "start": cur, "end": cur + sectors - 1, "type": code, "guid": guid,
                    "from": None if not sname else {"name": sname, "start": src[sname]["start"], "end": src[sname]["end"]}})
        cur = -(-(cur + sectors) // ALIGN) * ALIGN
    for n in new:
        for p in tparts:
            if not (n["end"] < p["start"] or n["start"] > p["end"]):
                sys.exit(f"REFUSED overlap: {n['name']} with partition {p['number']}")
    return {"schema": "awai.pc.ab-install.plan.v1", "target": os.path.basename(target), "source": os.path.basename(source),
            "existing": tparts, "freeRangeUsed": list(best), "new": new}


def apply(target, source, plan, record):
    before = {p["number"]: sha_range(target, p["start"], p["end"]) for p in plan["existing"]}
    for n in plan["new"]:
        args = [f"--new={n['number']}:{n['start']}:{n['end']}", f"--typecode={n['number']}:{n['type']}", f"--change-name={n['number']}:{n['name']}"]
        if n["guid"]:
            args.append(f"--partition-guid={n['number']}:{n['guid']}")
        sgdisk(*args, target)
    with open(target, "r+b") as t, open(source, "rb") as s:
        for n in plan["new"]:
            t.seek(n["start"] * SECTOR)
            if n["from"]:
                s.seek(n["from"]["start"] * SECTOR)
                left = (n["from"]["end"] - n["from"]["start"] + 1) * SECTOR
                while left:
                    b = s.read(min(left, 8 << 20))
                    t.write(b)
                    left -= len(b)
            else:
                # empty partitions: clear the first MiB so Android formats them
                t.write(b"\0" * min(1 << 20, (n["end"] - n["start"] + 1) * SECTOR))
        t.flush()
        os.fsync(t.fileno())
    after_parts, _, _ = table(target)
    byn = {p["number"]: p for p in after_parts}
    after, same = {}, True
    for p in plan["existing"]:
        q = byn.get(p["number"])
        ok = q is not None and (q["start"], q["end"], q["name"]) == (p["start"], p["end"], p["name"])
        after[p["number"]] = sha_range(target, p["start"], p["end"])
        same = same and ok and after[p["number"]] == before[p["number"]]
    out = dict(plan, schema="awai.pc.ab-install.record.v1", existingSha256Before=before, existingSha256After=after, existingUnchanged=same)
    with open(record, "x") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    print(json.dumps({"existingUnchanged": same, "record": record}))
    if not same:
        sys.exit("FAILED existing partition changed")


def main():
    a = sys.argv[1:]
    if len(a) < 3 or a[0] not in ("plan", "apply"):
        sys.exit(__doc__)
    gib = int(a[a.index("--userdata-gib") + 1]) if "--userdata-gib" in a else 16
    plan = make_plan(a[1], a[2], gib)
    if a[0] == "plan":
        print(json.dumps(plan, indent=2))
        return
    if "--record" not in a:
        sys.exit("apply needs --record FILE")
    apply(a[1], a[2], plan, a[a.index("--record") + 1])


if __name__ == "__main__":
    main()
