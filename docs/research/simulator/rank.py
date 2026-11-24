#!/usr/bin/env python3
"""Math-core simulator — reference implementation.

Computes, for each candidate mathematical system, a weighted fitness score over
the 14 practical axes and applies the hard safety constraints from the
architecture proposal (research/kotoba-mathematical-core.md).

IMPORTANT: the per-axis scores in systems.json are PROVISIONAL researcher-entered
reference values, not measurements. The score below is a ranking aid for
prioritising reference implementations; it is not evidence of performance.

Usage:
  python3 docs/research/simulator/rank.py
  python3 docs/research/simulator/rank.py --weight network=0 --weight cpu=5
  python3 docs/research/simulator/rank.py --json
  python3 docs/research/simulator/rank.py --scores systems.json --floor 8
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

DEFAULT_SCORES = Path(__file__).with_name("systems.json")


def load(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def apply_weight_overrides(data: dict, overrides: list[str]) -> dict:
    by_id = {axis["id"]: axis for axis in data["axes"]}
    for raw in overrides:
        if "=" not in raw:
            raise SystemExit(f"--weight expects axis=value, got {raw!r}")
        axis_id, _, value = raw.partition("=")
        if axis_id not in by_id:
            raise SystemExit(f"unknown axis {axis_id!r}; known: {', '.join(sorted(by_id))}")
        try:
            weight = int(value)
        except ValueError:
            raise SystemExit(f"weight for {axis_id!r} must be an integer 0..5, got {value!r}")
        if not 0 <= weight <= 5:
            raise SystemExit(f"weight for {axis_id!r} must be 0..5, got {weight}")
        by_id[axis_id]["weight"] = weight
    return data


def weight_total(data: dict) -> int:
    return sum(axis["weight"] for axis in data["axes"])


def score(data: dict, system: dict) -> float:
    """score = 100 * Σ(w_i · s_ji) / (10 · Σ(w_i)); 0 when every weight is 0."""
    total = weight_total(data)
    if total == 0:
        return 0.0
    earned = sum(axis["weight"] * system["scores"][axis["id"]] for axis in data["axes"])
    return 100.0 * earned / (10.0 * total)


def violations(data: dict, system: dict, floor: int) -> list[str]:
    """Axes where the system fails the hard safety constraint."""
    return [
        axis_id
        for axis_id in data["hardConstraints"]
        if system["scores"][axis_id] < floor
    ]


def rank(data: dict, floor: int) -> list[dict]:
    rows = []
    for system in data["systems"]:
        failed = violations(data, system, floor)
        rows.append(
            {
                "id": system["id"],
                "label": system["label"],
                "score": round(score(data, system), 2),
                "eligible": not failed,
                "failedConstraints": failed,
            }
        )
    rows.sort(key=lambda row: (-row["score"], row["label"]))
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Math-core fitness simulator (provisional scores)")
    parser.add_argument("--scores", type=Path, default=DEFAULT_SCORES)
    parser.add_argument("--weight", action="append", default=[], metavar="AXIS=VALUE")
    parser.add_argument("--floor", type=int, default=None, help="hard-constraint floor (default from data)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    data = apply_weight_overrides(load(args.scores), args.weight)
    floor = data["hardConstraintFloor"] if args.floor is None else args.floor
    rows = rank(data, floor)

    if args.json:
        print(json.dumps({"weightTotal": weight_total(data), "floor": floor, "rows": rows}, indent=2))
        return 0

    print(f"weight total: {weight_total(data)}  hard-constraint floor: {floor} "
          f"({', '.join(data['hardConstraints'])})")
    print(f"provenance: {data['provenance']['status']}")
    print()
    print(f"{'#':>3}  {'system':<46}{'score':>7}  status")
    for row in rows:
        status = "eligible" if row["eligible"] else "EXCLUDED: " + ",".join(row["failedConstraints"])
        print(f"{row['rank']:>3}  {row['label']:<46}{row['score']:>7.2f}  {status}")
    eligible = [row for row in rows if row["eligible"]]
    if eligible:
        print()
        print(f"first to build: {eligible[0]['label']} ({eligible[0]['score']:.2f})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
