# Measured baseline — M1–M4

Status: MEASURED 2026-11-24 at `481ab9e0`, on artifacts in this repository.
These numbers measure the **storage and transport layer** of a content-addressed
design. They are **not** evidence for any candidate mathematical system: no
reference implementation of rewriting logic, TRS, Matching Logic, or the other
candidates exists in this repo, so the simulator's per-system scores remain
provisional.

Axes covered: 4 of 14. Measured weight coverage = 18 of 59 weight points (30.5%)
— determinism 5, network 5, storage 4, CPU 4. The other 10 axes are unmeasured.

## Protocol

```bash
# 4 KiB blocks, small-document history
python3 docs/research/simulator/measure.py --corpus . --block 4096 \
  --history-file android/online-pins.dev.json \
  --out docs/research/measurement/measure-out-b4096.json

# 512 B blocks, larger-file history
python3 docs/research/simulator/measure.py --corpus . --block 512 \
  --history-file android/build.py \
  --out docs/research/measurement/measure-out-b512.json

# rig tests
python3 docs/research/simulator/test_measure.py
```

Corpus: 120 `*.json` files, 4,027,805 bytes, walked deterministically from the
repository root (`.git`, `node_modules`, `target`, `build`, `dist`, `.next`,
`__pycache__` skipped). Environment: macOS 26.3.1, arm64, 10 CPU, Python 3.9.6.
No network access. Re-running the rig reproduces every number except the timing
block; `test_measure.py` asserts that reproducibility.

## Results

| Axis | What is measured | Value | Output |
| --- | --- | --- | --- |
| M1 determinism | Canonical-form invariance: same logical JSON re-serialised with permuted key order and with indentation must hash to the same digest | 240/240 checks matched (120 files × 2 variants), 0 skipped, 0 failures | `measure-out-b4096.json` |
| M2 storage | Content-addressed dedup over the corpus: 1 − unique bytes / total bytes | fixed 4 KiB blocks: 0.51%; content-defined chunking: 2.42% | `measure-out-b4096.json` |
| M2 storage (512 B) | same, 512 B blocks | fixed: 0.86%; CDC: 2.42% | `measure-out-b512.json` |
| M3 network | Diff-sync bytes as a fraction of full-sync bytes across consecutive git revisions | `android/online-pins.dev.json` (5,700 B, 8 versions): fixed 100.0%, CDC 99.9% | `measure-out-b4096.json` |
| M3 network | same | `android/build.py` (52,233 B, 15 versions): fixed 73.1%, CDC 12.5% | `measure-out-b512.json` |
| M4 cost | Wall clock and peak RSS of the canonicalisation pass over the corpus | 0.029 s, 135–137 MB/s, 78 MB peak RSS | both |

## Numeric evaluation against the proposal's own targets

The survey (`math-systems-survey.md`) states initial targets. Measured against
them:

| Target in the survey | Measured | Verdict |
| --- | --- | --- |
| Storage: ≤80% of a non-deduplicated baseline (≥20% saved) | 0.51–2.42% saved | **NOT MET** on this corpus; shortfall ≈8–40× |
| Diff-sync: ≤20% of full-sync bytes | 12.5% with CDC on `build.py`; 73.1% with fixed blocks; 99.9% on a 5.7 KB document | **MET only** for CDC on a file much larger than the block size |
| Deterministic CID agreement: 100% | 240/240 = 100% | **MET** for the canonicaliser |
| CPU: ≥70% of an equivalent C implementation | — | **NOT MEASURABLE** without a comparison implementation |

Two findings worth keeping:

1. **Dedup is not free.** The corpus is 120 real JSON files that are mostly
   unique, so dedup saves almost nothing. The 20% storage target presumes
   duplicate or near-duplicate content; the ranking's "DAG/CID fit" weight
   should not be read as a storage win on data like this.
2. **Block size decides the network result.** The same history gives 73.1% with
   fixed 512 B blocks and 12.5% with content-defined chunking. On a 5.7 KB
   document with 4 KiB blocks there is no gain at all, because the document is
   smaller than a handful of blocks. The 20% network target is conditional on
   block size ≪ document size and on shift-resistant chunking.

## Falsification conditions

- M1: any file whose canonical digest changes under key permutation or
  re-indentation (float formatting, duplicate keys, `NaN`) would show as a
  failure row in the output.
- M2: a corpus with duplicate content should raise the dedup ratio; a ratio that
  stays near zero on a clearly duplicated corpus means the chunker is broken.
- M3: CDC must beat fixed blocks on an edit-heavy history. If it does not, the
  rolling hash is not producing content-dependent boundaries. Periodic data is a
  known degenerate case: the hash never hits a boundary and CDC falls back to
  fixed max-size blocks, so a CDC result on repetitive data is not evidence of
  shift resistance.
- M4: cost is a baseline for this canonicaliser only; it says nothing about any
  candidate system's execution cost.

## What to measure next

Axes still unmeasured: CPU/GPU throughput, RAM/cache, knowledge reasoning, LLM
efficiency, proof checking, security, termination/resource bounds, parallelism,
development productivity. Each needs a reference implementation and a fixed
benchmark from B01–B20; until then the simulator ranking stays a prioritisation
aid. The next rig should start with B09 (CID generation and verification) and
B20 (re-execution across environments), because both are measurable with the
same canonicaliser and need no candidate implementation.
