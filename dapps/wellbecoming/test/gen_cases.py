"""Rewrites test/cases.json. Run only to regenerate the shared cases:  python3 test/gen_cases.py

The expected values come from this file, which is a second, independent implementation of the
ADR 2611071400 definitions in exact rational arithmetic (fractions.Fraction). The core uses integer
tricks instead, so agreement between the two is evidence, not a copy. The random series use a
fixed seed, so the output is reproducible.
"""
import json
import random
from fractions import Fraction as F

OPTS = dict(cur=14, base=90, minc=5, minb=20, floor=50, tau=500)


def med(xs):
    s = sorted(xs)
    n = len(s)
    return F(s[n // 2]) if n % 2 else F(s[n // 2 - 1] + s[n // 2], 2)


def delta(obs, end, **kw):
    o = dict(OPTS, **kw)
    c_from = end - o["cur"]
    b_from = c_from - o["base"]
    cs = [x["x"] for x in obs if c_from < x["day"] <= end]
    bs = [x["x"] for x in obs if b_from < x["day"] <= c_from]
    if len(cs) < o["minc"] or len(bs) < o["minb"]:
        return {"status": "insufficient", "current-count": len(cs), "baseline-count": len(bs)}
    mb = med(bs)
    mad = med([abs(x - mb) for x in bs])
    scale = max(F(14826, 10000) * mad, F(o["floor"]))
    d = (med(cs) - mb) / scale
    return {"status": "ok", "delta-milli": int(d * 1000),  # int() truncates toward zero
            "current-count": len(cs), "baseline-count": len(bs)}


def direction(results, tau=500):
    ds = [r["delta-milli"] for r in results.values() if r["status"] == "ok"]
    if len(ds) < 2:
        return "insufficient-history"
    worse = any(d <= -tau for d in ds)
    better = any(d >= tau for d in ds)
    if worse and better:
        return "mixed"
    return "worsening" if worse else "improving" if better else "stable"


def local_index(results):
    ds = [r["delta-milli"] for r in results.values() if r["status"] == "ok"]
    if not ds:
        return None
    return int(F(sum(int(F(max(-3000, min(3000, d)), 3)) for d in ds), len(ds)))


def assess(series, end):
    res = {k: delta(v, end) for k, v in series.items()}
    return {"dimensions": res, "direction": direction(res), "local-index-milli": local_index(res)}


def run(days, value):
    return [{"day": d, "x": value(i)} for i, d in enumerate(days)]


cases = []


def case(fn, args, expect, note):
    cases.append({"fn": fn, "args": args, "expect": expect, "note": note})


def delta_case(obs, end, note, expect=None):
    case("dimension-delta", [obs, end], expect if expect is not None else delta(obs, end), note)


END = 200
C_DAYS = list(range(END - 4, END + 1))            # 196..200, five observations in C
B20 = list(range(97, 117))                         # twenty observations in B (days 97..116)

# The worked example in the ADR: B median 0.60 and MAD 0.04, C median 0.54.
adr_b = run(B20, lambda i: 560 if i % 2 == 0 else 640)
adr_c = run(C_DAYS, lambda _: 540)
assert delta(adr_b + adr_c, END)["delta-milli"] == -1011
delta_case(adr_b + adr_c, END, "ADR example: delta is about -1.01 z")

# The floor: MAD 5, median moves 20. Without the floor this would be -2.7 z.
fl_b = run(B20, lambda i: 595 if i % 2 == 0 else 605)
fl_c = run(C_DAYS, lambda _: 580)
assert delta(fl_b + fl_c, END)["delta-milli"] == -400
delta_case(fl_b + fl_c, END, "floor 0.05 keeps a tiny MAD from amplifying a small move")

# Exact boundaries at tau = 500 milli-z, all dominated by the floor (B has MAD 0).
flat_b = run(B20, lambda _: 600)
for c_val, want, note in [(575, -500, "exactly -tau"), (625, 500, "exactly +tau")]:
    obs = flat_b + run(C_DAYS, lambda _, v=c_val: v)
    assert delta(obs, END)["delta-milli"] == want
    delta_case(obs, END, "boundary: " + note)
six_c = [{"day": d, "x": v} for d, v in zip(range(195, 201), [575, 575, 575, 576, 576, 576])]
delta_case(flat_b + six_c, END, "median of an even count: 575.5, just inside the dead band (-490)")
assert delta(flat_b + six_c, END)["delta-milli"] == -490

# Minimum counts and window edges.
delta_case(flat_b + run(C_DAYS[1:], lambda _: 600), END, "C has 4 of 5 needed: insufficient")
delta_case(run(B20[1:], lambda _: 600) + run(C_DAYS, lambda _: 600), END, "B has 19 of 20 needed: insufficient")
delta_case(flat_b + run(C_DAYS, lambda _: 600), END, "exactly the minimum counts: ok, delta 0")
edge = (run([END - 14], lambda _: 700)            # day end-14 belongs to B, not C
        + run([END], lambda _: 300)               # day end belongs to C
        + run(range(END - 103, END - 14), lambda _: 600)   # B: end-103 .. end-15
        + run([END - 104], lambda _: 0)           # end-104 is outside B
        + run(range(END - 13, END), lambda _: 300))
delta_case(edge, END, "window edges: end-14 is in B, end is in C, end-104 is in neither")
case("dimension-delta", [None, END], delta([], END), "no observations at all: insufficient, never ok")
case("dimension-delta", [[], END], delta([], END), "empty list: insufficient")

# Invalid input is refused with a reason, never read as zero.
good = flat_b + run(C_DAYS, lambda _: 600)
for bad_x, why in [(1001, "above 1000"), (-1, "negative"), (5.5, "not an integer"), ("a", "a string")]:
    case("dimension-delta", [good + [{"day": 150, "x": bad_x}], END],
         {"status": "invalid", "reason": "bad-observation"}, "observation x " + why)
case("dimension-delta", [good + [{"day": 150.5, "x": 500}], END],
     {"status": "invalid", "reason": "bad-observation"}, "day is not an integer")
case("dimension-delta", [good + [7], END], {"status": "invalid", "reason": "bad-observation"},
     "an observation that is not a record")
case("dimension-delta", [good, None], {"status": "invalid", "reason": "bad-end-day"}, "no end day")
case("dimension-delta", [good, END, {"floor-permille": 0}], {"status": "invalid", "reason": "bad-options"},
     "floor 0 would divide by zero")
case("dimension-delta", [good, END, {"tau-milli": -5}], {"status": "invalid", "reason": "bad-options"},
     "tau must be positive")
case("dimension-delta", [good, END, {"floor-permille": 100}], delta(good, END, floor=100),
     "options override the defaults")

# Direction. The rule works from the worst side, never from a mean.
ok = lambda d: {"status": "ok", "delta-milli": d}
ins = {"status": "insufficient"}
for name, res, want in [
    ("one worsening dimension", {"a": ok(-600), "b": ok(0)}, "worsening"),
    ("one improving dimension", {"a": ok(700), "b": ok(100)}, "improving"),
    ("all inside the dead band", {"a": ok(-499), "b": ok(499)}, "stable"),
    ("both sides", {"a": ok(-600), "b": ok(900)}, "mixed"),
    ("mean is high but one dimension worsens: not improving", {"a": ok(-500), "b": ok(3000), "c": ok(3000)}, "mixed"),
    ("exactly -tau counts as worse", {"a": ok(-500), "b": ok(0)}, "worsening"),
    ("just inside -tau", {"a": ok(-499), "b": ok(0)}, "stable"),
    ("exactly +tau counts as better", {"a": ok(500), "b": ok(0)}, "improving"),
    ("one usable dimension is not enough", {"a": ok(-900), "b": ins}, "insufficient-history"),
    ("an invalid dimension is not usable", {"a": ok(-900), "b": {"status": "invalid", "reason": "x"}}, "insufficient-history"),
    ("no dimensions", {}, "insufficient-history"),
]:
    case("direction", [res], want, name)
case("direction", [None], "insufficient-history", "no results at all")
case("direction", [{"a": ok(-400), "b": ok(0)}, {"tau-milli": 300}], "worsening", "tau option")

# Hysteresis over windows.
states = [
    (None, "improving", {"confirmed": "improving", "pending": None, "count": 0}, "first window is accepted"),
    ({"confirmed": "stable", "pending": None, "count": 0}, "improving",
     {"confirmed": "stable", "pending": "improving", "count": 1}, "one window of change is not enough"),
    ({"confirmed": "stable", "pending": "improving", "count": 1}, "improving",
     {"confirmed": "improving", "pending": None, "count": 0}, "second window confirms"),
    ({"confirmed": "improving", "pending": None, "count": 0}, "worsening",
     {"confirmed": "worsening", "pending": None, "count": 0}, "worsening is confirmed at once"),
    ({"confirmed": "stable", "pending": "improving", "count": 1}, "stable",
     {"confirmed": "stable", "pending": None, "count": 0}, "returning to confirmed clears pending"),
    ({"confirmed": "stable", "pending": "improving", "count": 1}, "mixed",
     {"confirmed": "stable", "pending": "mixed", "count": 1}, "a different change restarts the count"),
    ({"confirmed": "worsening", "pending": None, "count": 0}, "stable",
     {"confirmed": "worsening", "pending": "stable", "count": 1}, "leaving worsening takes two windows"),
    ({"confirmed": "worsening", "pending": "stable", "count": 1}, "stable",
     {"confirmed": "stable", "pending": None, "count": 0}, "leaving worsening, second window"),
]
for st, raw, want, note in states:
    case("confirm", [st, raw], want, note)

# Local index (display only).
case("local-index-milli", [{}], None, "no dimensions: nil, not 0")
case("local-index-milli", [{"a": ins}], None, "only insufficient: nil")
case("local-index-milli", [{"a": ok(-1011), "b": ok(500)}], int(F(int(F(-1011, 3)) + int(F(500, 3)), 2)),
     "mean of delta/3, truncated")
case("local-index-milli", [{"a": ok(-9000), "b": ok(9000)}], 0, "clipped to +-3000 before the mean")
case("local-index-milli", [{"a": ok(-9000)}], -1000, "lowest possible")

# Whole assessment with the random series (fixed seed).
rng = random.Random(2611071400)


def series(center, spread, drift, gap):
    out = []
    for day in range(END - 14 - 90 + 1, END + 1):
        if rng.random() < gap:
            continue
        shift = drift if day > END - 14 else 0
        out.append({"day": day, "x": max(0, min(1000, int(rng.gauss(center + shift, spread))))})
    return out


for i in range(10):
    s = {"body": series(rng.randint(300, 800), rng.randint(5, 80), rng.randint(-250, 250), 0.1),
         "affect": series(rng.randint(300, 800), rng.randint(5, 80), rng.randint(-250, 250), 0.2),
         "rest": series(rng.randint(300, 800), rng.randint(5, 80), rng.randint(-250, 250), 0.05)}
    case("assess", [s, END], assess(s, END), "seeded random series %d" % i)
sparse = {"body": series(500, 30, 0, 0.1), "affect": []}
case("assess", [sparse, END], assess(sparse, END), "one dimension with data and one without")
case("assess", [{}, END], assess({}, END), "no dimensions")

# The export record: the only thing that may leave the device.
GOOD = {"pseudonymDid": "did:key:z6Mk-test", "windowEnd": 200, "trajectoryDirection": "worsening",
        "attestationCid": "bafy-attest", "encryptedPayloadCid": "bafy-payload"}
case("validate-export", [GOOD], {"ok": True}, "the five fields")
for field, value, reason in [
    ("score", 3, "forbidden-field"), ("population-baseline", "x", "forbidden-field"),
    ("rank", 1, "forbidden-field"), ("percentile", 90, "forbidden-field"),
    ("healthScore", 5, "forbidden-field"), ("health-score", 5, "forbidden-field"),
    ("cohort_id", "c", "forbidden-field"), ("peerDelta", 1, "forbidden-field"),
    ("delta", -1, "forbidden-field"), ("localIndex", 10, "forbidden-field"),
    ("leaderboard", [], "forbidden-field"), ("norm", 1, "forbidden-field"),
    ("note", "hi", "unknown-field"), ("deviceId", "d", "unknown-field"),
]:
    case("validate-export", [dict(GOOD, **{field: value})],
         {"ok": False, "reason": reason, "field": field}, "extra field " + field)
case("validate-export", [dict(GOOD, note="hi", rank=1)], {"ok": False, "reason": "forbidden-field", "field": "rank"},
     "a forbidden field is named before an unknown one")
for gone in sorted(GOOD):
    case("validate-export", [{k: v for k, v in GOOD.items() if k != gone}],
         {"ok": False, "reason": "missing-field", "field": gone}, "missing " + gone)
case("validate-export", [dict(GOOD, trajectoryDirection="great")], {"ok": False, "reason": "bad-direction"}, "not an enum value")
case("validate-export", [dict(GOOD, windowEnd="x")], {"ok": False, "reason": "bad-window-end"}, "window end is a string")
case("validate-export", [dict(GOOD, windowEnd=5.5)], {"ok": False, "reason": "bad-window-end"}, "window end is not an integer")
case("validate-export", [dict(GOOD, attestationCid="  ")], {"ok": False, "reason": "bad-value"}, "blank CID")
case("validate-export", [None], {"ok": False, "reason": "not-a-record"}, "nothing")
case("validate-export", [[1, 2]], {"ok": False, "reason": "not-a-record"}, "a list")
for d in ["improving", "stable", "worsening", "mixed", "insufficient-history"]:
    case("validate-export", [dict(GOOD, trajectoryDirection=d)], {"ok": True}, "direction " + d)
case("export-record", ["did:key:z6Mk-test", 200, "mixed", "bafy-attest", "bafy-payload"],
     {"ok": True, "record": dict(GOOD, trajectoryDirection="mixed")}, "builds the five fields")
case("export-record", ["did:key:z6Mk-test", 200, "great", "bafy-attest", "bafy-payload"],
     {"ok": False, "reason": "bad-direction"}, "refuses a bad direction")

with open("test/cases.json", "w") as f:
    json.dump(cases, f, indent=1, ensure_ascii=False)
    f.write("\n")
print(len(cases), "cases")
