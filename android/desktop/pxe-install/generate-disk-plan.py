#!/usr/bin/env python3
"""Generate sector-exact disk-plan evidence for 7735h.

Inputs are the recorded GPT (persistence/evidence/physical-gpt-audit-20261121.json)
and the KVM install record's source partition sizes
(pc-ab-device/evidence/install-record-kvm-20261119.json). The real
installer make_plan() is exercised with table() mocked, exactly as
test_awai_pc_install.py does; no device or image file is touched.
"""
import json
import sys
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

spec = spec_from_file_location(
    "awai_pc_install",
    ROOT / "android/desktop/pc-ab-device/awai-pc-install.py",
)
installer = module_from_spec(spec)
spec.loader.exec_module(installer)

AUDIT = json.loads(
    (ROOT / "android/desktop/persistence/evidence/physical-gpt-audit-20261121.json").read_text()
)
KVM = json.loads(
    (ROOT / "android/desktop/pc-ab-device/evidence/install-record-kvm-20261119.json").read_text()
)

S = 512
ALIGN = 2048
SECTORS = AUDIT["sectors"]  # 500118192
FIRST, LAST = AUDIT["firstUsableLba"], AUDIT["lastUsableLba"]
PARTS = [
    {"number": p["number"], "start": p["start"], "end": p["end"],
     "type": "EF00" if p["number"] == 1 else "8300", "name": p["name"]}
    for p in AUDIT["partitions"]
]
NEED_CD22C = AUDIT["installPlanning"]["minimumContiguousSectors"]  # 60082176, userdata 16 GiB
USERDATA_GIB = AUDIT["installPlanning"]["userdataGiB"]

# Source partitions for the KVM byname-v2 build (real sizes from the install record).
SRC = []
for n in KVM["new"]:
    if n["from"]:
        f = n["from"]
        SRC.append({"number": len(SRC) + 1, "start": f["start"], "end": f["end"],
                    "type": "EF00" if f["name"] == "EFI" else "8300", "name": f["name"]})
SRC_TABLE = {p["name"]: p for p in SRC}

TGT = "/tmp/pxe-plan-target.img"
SRCF = "/tmp/pxe-plan-source.img"
def mocked_plan(existing_parts, first, last, userdata_gib=16):
    Path(TGT).touch(exist_ok=True); Path(SRCF).touch(exist_ok=True)
    with patch.object(installer, "table", side_effect=[
        (existing_parts, first, last),
        (SRC, 34, SRC[-1]["end"] + 2048 if SRC else 4095),
    ]):
        return installer.make_plan(TGT, SRCF, userdata_gib)

def free_ranges(parts, first, last):
    return installer.free_ranges(parts, first, last)

def gib(sectors):
    return round(sectors * S / (1024 ** 3), 4)

out = {
    "schema": "awai.pc.7735h.disk-plan.v1",
    "date": "2026-11-23",
    "issue": "AWAI-3585/AWAI-3586",
    "recordedGpt": AUDIT,
    "notes": [
        "GPT bytes are the 2026-11-21 recorded audit, not the live disk.",
        "make_plan() was run with table() mocked (same technique as test_awai_pc_install.py) "
        "because sgdisk is not installed on this Mac and no stock disk image exists here.",
        "Per-partition source sizes below are the 2026-11-19 KVM byname-v2 build "
        "(install-record-kvm-20261119.json). The pinned candidate cd22c762 is a different "
        "build: only its total (60082176) is pinned. Exact cd22c placement needs its stock disk image.",
    ],
    "current": {
        "firstUsableLba": FIRST, "lastUsableLba": LAST,
        "partitions": PARTS,
        "freeRanges": [list(r) for r in free_ranges(PARTS, FIRST, LAST)],
        "minimumContiguousSectors": NEED_CD22C,
        "minimumContiguousGiB": gib(NEED_CD22C),
        "plannerOnCurrentLayout": AUDIT["installPlanning"]["plannerResult"],
        "p2Sectors": PARTS[1]["end"] - PARTS[1]["start"] + 1,
        "p2GiB": gib(PARTS[1]["end"] - PARTS[1]["start"] + 1),
        "p3Sectors": PARTS[2]["end"] - PARTS[2]["start"] + 1,
        "p3GiB": gib(PARTS[2]["end"] - PARTS[2]["start"] + 1),
        "p2DeletingAloneFreesLessThanNeed": (PARTS[1]["end"] - PARTS[1]["start"] + 1) < NEED_CD22C,
    },
}

# (a) erase whole disk
aligned_start = -(-FIRST // ALIGN) * ALIGN
erase_range = [aligned_start, LAST]
erase_len = erase_range[1] - erase_range[0] + 1
try:
    plan_a = mocked_plan([], FIRST, LAST)
    plan_a_result = {"result": "ok", "plan": plan_a}
except SystemExit as e:
    plan_a_result = {"result": "REFUSED", "message": str(e)}
out["option_a_erase"] = {
    "destroys": ["nvme0n1p1 (otehon-esp 2048-2099199)", "nvme0n1p2 (otehon-root 2099200-52430847, incl /awai-android-2992)",
                 "nvme0n1p3 (otehon-state 52430848-500118158, LUKS ~213 GiB)"],
    "freeRangeAfterErase": erase_range,
    "freeRangeSectors": erase_len,
    "freeRangeGiB": gib(erase_len),
    "fitsNeed": erase_len >= NEED_CD22C,
    "plan": plan_a_result,
}

# (b1) shrink p3 tail only; install at end of disk
# free range [F, LAST], F aligned, LAST-F+1 >= NEED
F_needed = LAST - NEED_CD22C + 1
# largest 2048-aligned F with [F, LAST] >= need (align DOWN, never up)
F = (F_needed // ALIGN) * ALIGN
if F < aligned_start:
    F = aligned_start
p3 = PARTS[2]
new_p3_end = F - 1
kept_p3 = new_p3_end - p3["start"] + 1
shrunk_parts = [
    PARTS[0], PARTS[1],
    {"number": 3, "start": p3["start"], "end": new_p3_end, "type": "8300", "name": "otehon-state"},
]
try:
    plan_b = mocked_plan(shrunk_parts, FIRST, LAST)
    plan_b_result = {"result": "ok", "plan": plan_b}
except SystemExit as e:
    plan_b_result = {"result": "REFUSED", "message": str(e)}
out["option_b1_shrink_p3_tail"] = {
    "frees": [F, LAST],
    "freesSectors": LAST - F + 1,
    "freesGiB": gib(LAST - F + 1),
    "fitsNeed": (LAST - F + 1) >= NEED_CD22C,
    "p3KeptSectors": kept_p3,
    "p3KeptGiB": gib(kept_p3),
    "p3TruncatedSectors": (p3["end"] - new_p3_end),
    "p3TruncatedGiB": gib(p3["end"] - new_p3_end),
    "destroys": ["otehon-state tail 28.65 GiB: LUKS volume + filesystem truncated; "
                 "needs unmount, filesystem shrink, backup. LUKS header (at p3 start) preserved."],
    "preserves": ["nvme0n1p1 (otehon-esp, full)", "nvme0n1p2 (otehon-root 24 GiB, full, incl /awai-android-2992)"],
    "plan": plan_b_result,
}

# (b2/b3) why other shrinks are not viable
p2 = PARTS[1]
out["option_b2_b3_not_viable"] = {
    "shrink_p2_alone_maxFrees": p2["end"] - p2["start"] + 1,
    "reason_p2_alone": "deleting/shrinking p2 (24.0 GiB) frees at most 50331648 sectors < 60082176",
    "reason_gap_before_p3": "any free range before p3 requires moving p3 start forward, which erases the "
                            "LUKS header at p3 start and destroys the encrypted volume; equivalent to (a) for p3.",
    "reason_shrink_p3_head_only": "new p3 start would be %d, LUKS header lost" % (p3["start"] + NEED_CD22C),
}

# (c) second disk
min_disk_sectors = aligned_start + NEED_CD22C + 33  # + GPT backup tail
try:
    plan_c = mocked_plan([], FIRST, LAST)
    plan_c_result = {"result": "ok", "plan": plan_c}
except SystemExit as e:
    plan_c_result = {"result": "REFUSED", "message": str(e)}
out["option_c_second_disk"] = {
    "destroys": ["only the new disk (erased)"],
    "touchesCurrentNvme": False,
    "minimumDiskSectors": min_disk_sectors,
    "minimumDiskGiB": gib(min_disk_sectors),
    "recommendation": "use a 512e disk >= 64 GiB (installer refuses non-512 logical sectors); "
                      "firmware boot entry / GRUB ESP choice must be qualified (OVMF skipped the first ESP "
                      "without a loader, pc-ab-device README Known gaps).",
    "planOnBlankDisk": plan_c_result,
}

# KVM-source placement total check
total = installer.make_plan if False else None
vec = 0
# compute aligned total for KVM source (16 GiB userdata)
layout = installer.LAYOUT[:-1] + installer.vbmeta_layout(SRC) + installer.LAYOUT[-1:]
tot = 0
for name, sname, guid, code in layout:
    if sname:
        n = SRC_TABLE[sname]["end"] - SRC_TABLE[sname]["start"] + 1
    elif name == "userdata":
        n = 16 * (1 << 30) // S
    else:
        n = installer.EMPTY_SECTORS[name]
    tot += -(-n // ALIGN) * ALIGN
out["kvmSourceAlignedTotalSectors"] = tot
out["kvmSourceAlignedTotalGiB"] = gib(tot)

print(json.dumps(out, indent=2))
