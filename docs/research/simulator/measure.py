#!/usr/bin/env python3
"""Measurement rig — real numbers on real artifacts in this repository.

The simulator (rank.py) scores candidate mathematical systems from
researcher-entered reference values. This rig measures the same kind of
properties on actual files, so each number comes from a command instead of an
assertion.

Axes measured here (4 of the 14 in the simulator):
  M1 determinism   canonical-form invariance rate (key order + whitespace)
  M2 storage       content-addressed dedup ratio over a fixed corpus
  M3 network       diff-sync bytes vs full-sync bytes over git history
  M4 cost          wall clock + peak RSS of the canonicalisation pass

Axes NOT measured here: CPU/GPU throughput, termination proof rate, proof
checking, parallelism. Those need a reference implementation of each candidate
system and stay PROVISIONAL (see docs/research/kotoba-mathematical-core.md).

Everything is computed from files in this repo. Nothing is hand-entered, and
no network access is used. Re-run to reproduce:

  python3 docs/research/simulator/measure.py --corpus . --out measure-out.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import random
import resource
import subprocess
import sys
import time
from pathlib import Path

SKIP_DIRS = {".git", "node_modules", "target", "build", "dist", ".next", "__pycache__"}


# --------------------------------------------------------------------------- #
# canonical form
# --------------------------------------------------------------------------- #
def canonical(obj) -> bytes:
    """Canonical bytes: sorted keys, no insignificant whitespace, UTF-8."""
    return json.dumps(
        obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def shuffle_keys(obj, rng: random.Random):
    """Deterministic key-order permutation; values keep their order."""
    if isinstance(obj, dict):
        items = list(obj.items())
        rng.shuffle(items)
        return {k: shuffle_keys(v, rng) for k, v in items}
    if isinstance(obj, list):
        return [shuffle_keys(v, rng) for v in obj]
    return obj


# --------------------------------------------------------------------------- #
# corpus
# --------------------------------------------------------------------------- #
def corpus_files(root: Path, limit: int, max_bytes: int) -> list[Path]:
    found: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for name in sorted(filenames):
            if name.endswith(".json"):
                found.append(Path(dirpath) / name)
    found.sort()
    kept: list[Path] = []
    total = 0
    for path in found:
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if total + size > max_bytes:
            continue
        kept.append(path)
        total += size
        if len(kept) >= limit:
            break
    return kept


# --------------------------------------------------------------------------- #
# M1 — determinism
# --------------------------------------------------------------------------- #
def measure_determinism(paths: list[Path], variants: int) -> dict:
    rng = random.Random(20261124)
    parsed = 0
    skipped = 0
    variant_total = 0
    variant_matched = 0
    failures: list[dict] = []

    for path in paths:
        try:
            obj = json.loads(path.read_text(encoding="utf-8"))
            base = digest(canonical(obj))
        except Exception as exc:  # invalid JSON, NaN, duplicate-key oddity
            skipped += 1
            failures.append({"file": str(path), "stage": "parse", "error": type(exc).__name__})
            continue
        parsed += 1

        for index in range(variants):
            try:
                if index % 2 == 0:
                    candidate = canonical(shuffle_keys(obj, rng))
                else:
                    candidate = canonical(
                        json.loads(json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False))
                    )
            except Exception as exc:
                variant_total += 1
                failures.append(
                    {"file": str(path), "stage": f"variant-{index}", "error": type(exc).__name__}
                )
                continue
            variant_total += 1
            if digest(candidate) == base:
                variant_matched += 1
            else:
                failures.append({"file": str(path), "stage": f"variant-{index}", "error": "digest-differs"})

    return {
        "files_parsed": parsed,
        "files_skipped": skipped,
        "variants": variants,
        "variant_checks": variant_total,
        "variant_matched": variant_matched,
        "invariance_rate": f"{variant_matched}/{variant_total}" if variant_total else "0/0",
        "invariance_fraction": (variant_matched / variant_total) if variant_total else None,
        "failures": failures[:20],
        "failure_count": len(failures),
    }


# --------------------------------------------------------------------------- #
# M2 — storage / dedup
# --------------------------------------------------------------------------- #
def fixed_blocks(data: bytes, size: int) -> list[bytes]:
    return [data[i : i + size] for i in range(0, len(data), size)] or [b""]


def cdc_blocks(
    data: bytes,
    mask: int = 0x3FF,
    min_size: int = 256,
    max_size: int = 8192,
    window: int = 32,
) -> list[bytes]:
    """Content-defined chunking with a windowed rolling hash.

    A boundary depends only on the last `window` bytes, so inserting bytes at
    the front does not shift every later block (unlike fixed-size blocks).
    """
    base = 257
    mod = 1 << 32
    pow_window = pow(base, window, mod)
    blocks: list[bytes] = []
    start = 0
    h = 0
    for i, byte in enumerate(data):
        h = (h * base + byte) % mod
        if i - start >= window:
            h = (h - data[i - window] * pow_window) % mod
        size = i + 1 - start
        if size >= min_size and ((h & mask) == 0 or size >= max_size):
            blocks.append(data[start : i + 1])
            start = i + 1
            h = 0
    if start < len(data):
        blocks.append(data[start:])
    return blocks or [b""]


def measure_storage(paths: list[Path], block_size: int) -> dict:
    total = 0
    unique: dict[str, int] = {}
    cdc_total = 0
    cdc_unique: dict[str, int] = {}
    read_failures = 0

    for path in paths:
        try:
            data = path.read_bytes()
        except OSError:
            read_failures += 1
            continue
        total += len(data)
        for block in fixed_blocks(data, block_size):
            unique.setdefault(digest(block), len(block))

        for block in cdc_blocks(data):
            cdc_total += len(block)
            cdc_unique.setdefault(digest(block), len(block))

    unique_bytes = sum(unique.values())
    cdc_unique_bytes = sum(cdc_unique.values())
    return {
        "block_size": block_size,
        "files": len(paths) - read_failures,
        "bytes_total": total,
        "bytes_unique_fixed": unique_bytes,
        "dedup_ratio_fixed": (1 - unique_bytes / total) if total else None,
        "blocks_total_fixed": None,
        "bytes_unique_cdc": cdc_unique_bytes,
        "dedup_ratio_cdc": (1 - cdc_unique_bytes / cdc_total) if cdc_total else None,
        "cdc_bytes_total": cdc_total,
    }


# --------------------------------------------------------------------------- #
# M3 — network / diff sync
# --------------------------------------------------------------------------- #
def git_versions(repo: Path, path: str) -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(repo), "rev-list", "--reverse", "HEAD", "--", path],
        capture_output=True,
        text=True,
        check=True,
    )
    return [line for line in out.stdout.splitlines() if line.strip()]


def git_blob(repo: Path, rev: str, path: str) -> bytes:
    out = subprocess.run(
        ["git", "-C", str(repo), "show", f"{rev}:{path}"],
        capture_output=True,
        check=True,
    )
    return out.stdout


def measure_network(repo: Path, path: str, block_size: int) -> dict:
    revs = git_versions(repo, path)
    if len(revs) < 2:
        return {"path": path, "versions": len(revs), "error": "need at least two versions"}

    pairs: list[dict] = []
    prev_fixed = set()
    prev_cdc = set()
    prev_bytes = b""
    for rev in revs:
        data = git_blob(repo, rev, path)
        fixed = {digest(b) for b in fixed_blocks(data, block_size)}
        cdc = {digest(b) for b in cdc_blocks(data)}

        if prev_bytes:
            changed_fixed = sum(
                len(b) for b in fixed_blocks(data, block_size) if digest(b) not in prev_fixed
            )
            changed_cdc = sum(len(b) for b in cdc_blocks(data) if digest(b) not in prev_cdc)
            pairs.append(
                {
                    "rev": rev[:8],
                    "full_bytes": len(data),
                    "diff_fixed_bytes": changed_fixed,
                    "diff_cdc_bytes": changed_cdc,
                    "ratio_fixed": changed_fixed / len(data) if data else None,
                    "ratio_cdc": changed_cdc / len(data) if data else None,
                }
            )
        prev_fixed = fixed
        prev_cdc = cdc
        prev_bytes = data

    def mean(values):
        values = [v for v in values if v is not None]
        return sum(values) / len(values) if values else None

    return {
        "path": path,
        "versions": len(revs),
        "block_size": block_size,
        "pairs": pairs,
        "mean_ratio_fixed": mean([p["ratio_fixed"] for p in pairs]),
        "mean_ratio_cdc": mean([p["ratio_cdc"] for p in pairs]),
        "full_bytes_total": sum(p["full_bytes"] for p in pairs),
        "diff_bytes_fixed_total": sum(p["diff_fixed_bytes"] for p in pairs),
        "diff_bytes_cdc_total": sum(p["diff_cdc_bytes"] for p in pairs),
    }


# --------------------------------------------------------------------------- #
# M4 — cost
# --------------------------------------------------------------------------- #
def measure_cost(paths: list[Path]) -> dict:
    peak_before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    started = time.perf_counter()
    total = 0
    ok = 0
    for path in paths:
        try:
            data = path.read_bytes()
            total += len(data)
            canonical(json.loads(data.decode("utf-8")))
            ok += 1
        except Exception:
            continue
    elapsed = time.perf_counter() - started
    peak_after = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # ru_maxrss is bytes on macOS, kilobytes on Linux.
    scale = 1 if sys.platform == "darwin" else 1024
    return {
        "files": ok,
        "bytes": total,
        "wall_seconds": round(elapsed, 6),
        "mb_per_second": round((total / 1e6) / elapsed, 3) if elapsed else None,
        "peak_rss_bytes_before": peak_before * scale,
        "peak_rss_bytes_after": peak_after * scale,
    }


# --------------------------------------------------------------------------- #
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", default=".", help="root directory to scan for *.json")
    parser.add_argument("--files", type=int, default=120, help="max files in the corpus")
    parser.add_argument("--max-bytes", type=int, default=8_000_000, help="corpus byte cap")
    parser.add_argument("--block", type=int, default=4096, help="fixed block size")
    parser.add_argument("--variants", type=int, default=2, help="shuffled variants per file")
    parser.add_argument("--history-file", default="android/online-pins.dev.json")
    parser.add_argument("--out", default=None, help="write JSON results here")
    args = parser.parse_args()

    root = Path(args.corpus).resolve()
    paths = corpus_files(root, args.files, args.max_bytes)
    if not paths:
        print(f"no JSON files found under {root}", file=sys.stderr)
        return 2

    head = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
        capture_output=True,
        text=True,
    ).stdout.strip()

    result = {
        "kind": "measurement",
        "not_evidence_for": "candidate mathematical systems (no reference implementation yet)",
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "machine": platform.machine(),
            "cpu_count": os.cpu_count(),
            "git_head": head,
        },
        "corpus": {
            "root": str(root),
            "files": len(paths),
            "bytes": sum(p.stat().st_size for p in paths),
        },
        "M1_determinism": measure_determinism(paths, args.variants),
        "M2_storage": measure_storage(paths, args.block),
        "M3_network": measure_network(root, args.history_file, args.block),
        "M4_cost": measure_cost(paths),
    }

    text = json.dumps(result, indent=2, sort_keys=True)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
