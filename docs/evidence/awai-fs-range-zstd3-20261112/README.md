# AWAI-531 — verified Range + segmented Zstd-3 implementation comparison

2026-11-12 JST. This implements the two measured improvements on the bounded
Otehon hosted Pack adapter. It does not migrate/rewrite the installed AwaiVol
raw-chunk daemon, Native or a live filesystem. PR97 contains the source, tests,
CLI, Nix pin and these measurements. The original dated efficiency report stays
at `../awai-fs-efficiency-20261112/`; its full-resident37.69% compression result
is a separate corpus and must not be substituted with the synthetic ratios here.

## Implemented boundary

- `pack/read-range-verified-leaves`: positioned reads of necessary complete raw
  leaves; verify their canonical CID digests, then slice requested bytes against
  a fully verified recovered snapshot. Raw ranges do not read the entire CAR.
- `pack/put-data-zstd3!` / `import-car-zstd3!`: explicit, versioned physical
  `.zpack` container over the identical canonical CAR, with independent64KiB
  Zstd-3 frames and stored/raw hashes, bounded strict directory and exact extents.
  Original CAR bytes/root/payload CIDs survive export and fresh recovery. No
  uncompressed CAR duplicate is retained for compressed entries.
- Frames and whole container use explicit size policies. Raw frames avoid
  expansion; if directory+frames are not smaller than the complete raw CAR,
  keep the original raw-CAR format and report that decision. Failed codec calls
  refuse. Entropy fixtures therefore have no storage expansion.
- Efficient compressed reads recheck selected stored frames even on hits,
  decode only missing frames, and verify complete touched leaves. Four decoded
  frames (256KiB total) are retained per recovered handle, shared across files.
  Missing independent frames share one bounded decoder process; each decoded
  raw frame is still checked separately. Format bytes are unchanged by batching.
- Strict `read-range`, `read-data`, CAR export, writer preflight, recovery and
  checkpoint retain complete-representation checks. Efficient Range does **not**
  scrub unread bytes/header; strict operations still refuse unread corruption.
  New CLI verbs expose the scope explicitly. The standalone range CLI first
  performs full recovery; timings below measure repeated library-handle reads.
- Publication uses the existing writer lock, force/rename/directory-sync and
  WAL/root ordering. No garbage collection, automatic format migration, service
  update or new execution authority was added. This is not a new CARv2 dialect.

The exact physical layout, parser/process/memory limits and API/CLI commands are
in `nixos/otehon/storage/README.md`. `validation.json` pins runtime source and
measurement-driver hashes. The dependency CAR codec is unchanged.

## Matched measurement method

Baseline: immutable `0fe5b31f52cca34efe2ae991c5f68f24b456f30c`, extracted with
`git archive` to task-owned scratch. Final runtime: `82daebc` (full SHA in
validation.json). Initial per-frame decoder: `2dd071b`, preserved in
`candidate-before-batching.json`. Same BB1.12.218, Zstd1.5.7, local32GiB Mac and
public byte-generators as the previous report. Source version comparisons use
separate BB processes/classpaths and new stores, with no live-store access.

Four deterministic public corpora: pattern/JSON-like/seeded entropy131,109 B;
seeded entropy524,288 B. Every candidate matches baseline payload SHA, canonical
CAR SHA and root CID. Full and both range outputs were independently checked.
One put and checkpoint per store; seven recovery observations after a warmup;
30 measured warm reads after a verified warmup. Cold-decoded readings clear only
the four-frame cache per request (seven observations); OS cache remains warm.

Cross-leaf range is `[65000,69096)`, aligned range `[0,4096)`. Byte counters are
application bytes read from the payload descriptor, not physical device I/O.
All raw times, same-process strict controls, n/p50/p95/p99 and decoder counters
are retained. Shared host load, nice15, no cache flush or exclusive CPU. n7/n30
p99 are maxima; no stable tail/production-SLO inference. Baseline ran before
candidate; strict controls in each candidate process help expose drift.

## Read results

| Case | Immutable baseline p50 | New raw-leaf p50 | New raw-leaf p95 | Application bytes before → after |
|---|---:|---:|---:|---:|
| 512KiB entropy, cross-leaf4KiB | 2.933 ms | 0.774 ms | 0.853 ms | 525,085 → 131,072 B |
| 512KiB entropy, aligned4KiB | 2.931 ms | 0.411 ms | see raw JSON | 525,085 → 65,536 B |
| 131,109 B pattern, cross-leaf4KiB | 0.792 ms | 0.801 ms | 0.817 ms | 131,504 → 131,072 B |
| 131,109 B JSON-like, cross-leaf4KiB | 0.781 ms | 0.752 ms | 0.775 ms | 131,504 → 131,072 B |

The large cross-leaf case is about3.79× faster in this run with75.04% fewer
application bytes (128.19× →32× amplification). Aligned amplification is16×,
not1×, because complete64KiB leaf verification is mandatory. The small
cross-leaf case barely saves bytes and its latency is effectively flat/noisy.
This is not an unconditional Range speedup. New raw strict controls remain
about0.77–0.82ms for small CARs and2.96ms for the large CAR.

## Actual segmented representation: space and latency together

Payload bytes include the complete compressed-container directory. Total-store
bytes include all retained metadata/history after the matched single put and
checkpoint; they are not minimum live metadata or exclusive APFS allocation.

| Corpus | Raw CAR → chosen stored payload | Total store before → after | Payload saving | Warm compressed cross-leaf p50 | Cold decoded cross-leaf p50 |
|---|---:|---:|---:|---:|---:|
| Pattern131,109 B | 131,504 →2,028 B | 133,200 →3,938 B | 98.46% | 0.866 ms | 6.602 ms |
| JSON-like131,109 B | 131,504 →1,370 B | 133,200 →3,280 B | 98.96% | 0.886 ms | 6.543 ms |
| Entropy131,109 B | 131,504 →131,504 B (raw) | 133,200 →133,200 B | 0% | 0.762 ms (raw) | 0.763 ms (raw) |
| Entropy524,288 B | 525,085 →525,085 B (raw) | 526,781 →526,781 B | 0% | 0.757 ms (raw) | 0.758 ms (raw) |

Selected compressed bytes/request are1,207 B (pattern) /549 B (JSON-like),
versus131,504 B in the original raw strict path. Warm compressed reads are
still slightly slower than the corresponding ~0.79ms raw baseline. Cold
external decode remains much slower. Initial candidate used three decoder
processes per cold cross-leaf request and measured14.698/14.866ms; batching
reduces it to one process and6.602/6.543ms (about55% less), while warm calls
start no decoder. Seven cold requests produced exactly seven decoder processes.

Recovery also pays the codec cost: pattern92.942 →105.354ms; JSON-like87.530
→107.734ms p50. Entropy stays raw. First-put timings are single observations
and include compression/validation/publication; do not treat apparent timing
wins as sustained write throughput. No live service/read latency improvement
is claimed: the installed daemon has not been switched to this adapter.

## Validation and next implementation gate

Pinned Nix hosted check passed: **23 tests /139 assertions**, including selected
leaf/frame corruption even after cache hit, unread-corruption strict refusal,
closed/bounded directories, truncation/symlink/reference mismatch, random mixed
ranges and a snapshot-wide cache ceiling. Existing30 raw Pack and30 compressed
payload/WAL/root/checkpoint process-kill cases passed with real killed writers,
exclusive-writer refusal, fresh-process recovery, orphan retry and CAR parity.
CLI raw/compressed export and cross-leaf range results match. Root/CAR/payload
identity checks passed across all eight candidate cases. No integrity check
was removed from the original APIs.

This implements the requested bounded Otehon APIs and comparisons. Keep opt-in:
next gate is to reduce cold decode/process cost without widening dependencies,
measure real service end-to-end integration, and qualify100k files, concurrency,
cold disk, large production objects, encryption and remote/distributed recovery.
A cache-hit benchmark cannot authorize replacing whole-object scrub semantics.
Do not silently repurpose the installed raw `.car` packs as compressed files.
Broader AWAI-531 remains In Progress; no production cutover is included.

## Reproduce

```sh
# Extract the immutable baseline into a NEW task-owned directory.
git archive 0fe5b31f52cca34efe2ae991c5f68f24b456f30c nixos/otehon/storage | tar -x -C BASELINE_SOURCE
nice -n 15 bb -cp BASELINE_SOURCE/nixos/otehon/storage/src:BASELINE_SOURCE/nixos/otehon/storage/vendor/apex/src:BASELINE_SOURCE/nixos/otehon/storage/vendor/apex-car/src \
 scripts/storage-efficiency/compare-range.clj baseline NEW_BASELINE_STORE NEW_BASELINE_REPORT.json
nice -n 15 bb -cp nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src \
 scripts/storage-efficiency/compare-range.clj candidate NEW_CANDIDATE_STORE NEW_CANDIDATE_REPORT.json
nix-build nixos/otehon/storage/check.nix --no-out-link
```

The driver refuses existing output stores/reports. Source tokens/model/effort
and token forecast remain unknown/uncalibrated; no provider usage counters were
available. Parent worktrees, live stores, secrets and existing services remain
outside this isolated task. Raw JSON and synthetic fixtures carry no private
profile content. This implementation is Otehon, not Native qualification.
