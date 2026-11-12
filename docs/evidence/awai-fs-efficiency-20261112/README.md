# Awai FS efficiency measurements — 2026-11-12 JST

Measured 11:11–11:15 JST on MacBookPro18,4 / 32 GiB / macOS (exact version in
`environment.json`). Tracking: AWAI-531, Project “AWAI Network — 分散型 dapps と経済圏（anatomy）”.
Run: `AWAI-531-efficiency-20261112`. No live data, manifests, services or parent
worktrees changed. Only aggregate metrics and hashes are retained here; actual
private filenames and payloads are excluded. Existing workload was not isolated;
processes ran at nice 15. No filesystem/page-cache flush or remote B2 query.

## Installed AwaiVol: full resident inventory

Source hashes are in `environment.json`. The installed daemon stores raw chunk
concatenations: its `.car` suffix is **not CARv2**. This and the isolated Otehon
CARv2 prototype below are different execution paths. No runtime migration occurred.
`live-audit.json` contains a consistent manifest snapshot (same digest before and
after the entire full compression audit).

| Measure | Observed |
|---|---:|
| Files / logical file bytes | 1,135 / 37,838,943 B |
| Chunk references / unique live chunks | 1,157 / 523 |
| Unique live bytes / resident Pack bytes | 35,261,893 B / 35,261,893 B |
| Dedup saving against logical bytes | 2,577,050 B / 6.81% |
| Resident / referenced Packs | 498 / 498 |
| Referenced Packs not resident | 0 (this snapshot) |
| Unreferenced/slack estimate from live interval union | 0 B |
| Manifest / journal | 481,604 B / 0 B |
| Resident APFS allocated bytes | 36,352,000 B |

Allocated-minus-length is 1,090,107 B (3.09% of Pack bytes). APFS `st_blocks`
is not exclusive/billed physical capacity; snapshots/clones and device behavior
are not accounted for. Slack estimate is interval arithmetic over this manifest,
not a full integrity audit or permission to delete. Nonresident objects in future
snapshots may be tiered rather than lost. This census is not the remote bucket,
backup copies, full historical datasets, or distributed repair traffic.

## Lossless compression oracle: every resident Pack

All 498 nonempty resident Packs, 35,261,893 B, were read locally and compressed
individually with Zstd 1.5.7 / one thread. Every individual frame and each combined
stream was decompressed and compared byte-for-byte (1,497 roundtrips). Private
payloads and compressed frames stayed in memory; no live bytes were rewritten.
An earlier size-quantile pilot is retained only in task scratch; the full census
supersedes its biased 3.15× sample ratio.

| Candidate | Separate Pack frames | Raw/compressed | Byte reduction | One concatenated stream |
|---|---:|---:|---:|---:|
| Current raw | 35,261,893 B | 1.000× | 0% | — |
| Zstd-1 | 22,027,469 B | 1.601× | 37.53% | 21,583,423 B |
| Zstd-3 | 21,972,182 B | 1.605× | 37.69% | 21,391,044 B |
| Zstd-9 | 21,761,232 B | 1.620× | 38.29% | 20,741,079 B |

Level 9 saves only another 210,950 B (0.96%) versus level 3 in separate Pack
frames. Concatenation saves another 581,138 B (2.64%) at level 3, but changes
random access and recovery granularity. It is a comparison bound, not an
implemented seekable layout. The installed payload path has no generic compression.
CLI elapsed measurements (including process spawn) are single samples, not a
calibrated throughput/CPU benchmark or evidence that level 3 is always faster.
No provider bill, network cost or large-dataset ratio is inferred.

## Query and reads

Installed metadata microbenchmarks: one warmup, 30 samples; warm in-process/page
cache. JSON parse p50/p95/p99 was 1.423/1.674/1.761 ms. An entire 1,135-path prefix
scan was 0.025/0.040/0.085 ms. A batch of 1,000 identical hot object-map lookups
was 0.009/0.023/0.030 ms; this is a JS microbenchmark, not service query latency.
The prefix and object names are intentionally absent from the report.

The existing loopback AwaiVol HTTP service also returned verified `206` responses
for 1,024 B ranges of the existing 3,461 B public node-observation fixture.
After one warmup, 30 requests: **p50 0.837 ms; p95 6.908 ms; p99 8.571 ms**.
Every response body and Content-Range matched. Connection/server/cache overhead is
included; physical disk bytes, cache hit ratio and CPU were not instrumented.
Read load was 31 KiB plus protocol overhead; no write or cache flush occurred.
`http-range.json` retains raw times. Datalog/Prolly execution and remote query are
unmeasured: this installed file service does not expose those query semantics.

## Pinned isolated Otehon Pack / CARv2

Source `8181b8f29d68b490a8bdd1518bdd58f76113126c`, BB 1.12.218; canonical codec
pin `df68aad6101d7bf9587ea48bc30946b834aa4ba2` and digest in `environment.json`.
The existing bounded profile uses 64 KiB raw leaves, one DAG-CBOR root, indexless
CARv2 (no padding/index), at most 900 KiB payload / 1 MiB CAR. This script uses
that exact implementation and its fsync/WAL publication; it defines no new CID.
Synthetic public inputs: deterministic pattern, JSON-like text and seeded entropy
(131,109 B each), plus seeded entropy (524,288 B). Full and cross-leaf 4 KiB range
readbacks matched their input bytes; root, CAR and payload hashes are retained.

| Input | CAR size / framing overhead | First put | Reused-put p50 | Recover p50 | 4 KiB read p50/p95 | Application read amplification |
|---|---:|---:|---:|---:|---:|---:|
| Pattern 131,109 B | 131,504 B / 0.301% | 236.3 ms | 308.2 ms | 91.9 ms | 0.833 / 1.037 ms | 32.11× |
| JSON-like 131,109 B | 131,504 B / 0.301% | 217.8 ms | 267.3 ms | 86.5 ms | 0.788 / 0.911 ms | 32.11× |
| Entropy 131,109 B | 131,504 B / 0.301% | 190.4 ms | 253.2 ms | 87.9 ms | 0.962 / 6.992 ms | 32.11× |
| Entropy 524,288 B | 525,085 B / 0.152% | 728.3 ms | 1,144.7 ms | 325.2 ms | 3.062 / 3.223 ms | 128.19× |

First put is one observation. Reused-put n=6 uses the same immutable CAR/name
and still publishes metadata; it is not a fresh-object throughput measurement.
Recover n=7 follows one warmup; it resets the derived-index cache but the OS cache
stays warm. Read n=30 follows a warmup. Nearest-rank p95/p99 for n=7 equal the max;
30-sample p99 is also the max, not a stable tail estimate. Raw times are recorded.
The first non-raw run had differing latency; these numbers are observations under
shared load, not repeatable hardware service-level limits.

Each 131,109 B fixture retained 143,545 B total after seven puts/checkpoint: CAR
131,504 B plus 12,041 B retained metadata/history. Retained metadata is not the
minimum live metadata size, nor garbage proven safe to collect. The larger
fixture has the same 12,041 B retained metadata. CAR framing is modest; application
read amplification and re-verification dominate these bounded tests.

Code explanation: `otehon/pack_store.clj:160` exports the entire CAR;
`:165` read-range calls it, then slices verified bytes. `otehon/storage.clj:158`
re-hashes the entire CAR on every read. `pack_store.clj:112–140` recovery rebuilds
indexes and verifies committed CAR contents. Counters measure application bytes
returned by file reads, **not physical disk I/O**. Integrity checks are required;
removing them to improve numbers would change the contract.

## Improvement candidates and acceptance

1. **High priority — verified positioned range reads (AWAI-531/532).** Preserve
   CID/root checks and immutable snapshot binding while validating only the
   necessary complete leaf blocks through the canonical codec. Separate full
   recovery/scrub from repeat reads when a qualified integrity boundary permits.
   Compare aligned, cross-leaf and random ranges at 4 KiB/64 KiB/large blobs;
   count actual bytes/hash work, refuse corruption and stale index/root cases.
   Current 512 KiB case reads 525,085 B per 4,096 B response (128.19×).
2. **High priority — framed Zstd candidate.** Compare level 1/3 first, with level
   9 as a control. The measured whole-resident opportunity is about 13.29 MB at
   level 3. Use bounded independently decodable frames and a reviewed directory;
   whole-CAR `.zst` breaks current raw offsets and cannot silently replace `.car`.
   Preserve exact decompressed bytes/CIDs, corruption refusal, encrypted-storage
   boundary and range behavior. Native and Otehon qualify separately.
3. **Medium — multi-file small-Pack packing / metadata batching.** There are 498
   resident Packs for 35.26 MB. Compare fixed object-count/pack-size workloads and
   recovery granularity; theoretical request-count savings are unmeasured.
   The concatenated compression bound is only 2.64% better at level 3, so do not
   sacrifice recovery/range behavior just for that space gain. WAL/force/rename
   ordering and unknown outcomes must remain correct when batching.
4. **Measure before optimizing query indexes.** Current 1,135-path warm scan is
   tiny. Expand to the issue's 100k-small-file/large-blob corpus, real ordered
   range/Datalog semantics, fixed query basis, policy and revocation epoch, then
   compare Prolly/B+/LSM and allocations/cache misses. Current map timings do not
   establish production query efficiency or a need to replace the index.
5. **No current evidence for GC/repack savings.** Live interval census found
   zero slack. Recovery remnants in the isolated test do not authorize deleting
   production objects. Remote replication/EC/repair, cold-cache disk I/O,
   sustained concurrency, CPU cycles, peak RSS, durability and RPO/RTO are open.

## Reproduce

From repository root; all NEW paths must be task-owned. `--full` is capped at
64 MiB resident payload; no payload is uploaded. Synthetic stores stay separate.
Do not point the Pack benchmark at a live store.

```sh
nice -n 15 node scripts/storage-efficiency/live-audit.mjs VOLUME_ROOT NEW_LIVE_REPORT.json --full
nice -n 15 bb -cp nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src \
  scripts/storage-efficiency/pack-bench.clj NEW_SYNTHETIC_DIR NEW_PACK_REPORT.json
node scripts/storage-efficiency/http-range.mjs EXISTING_PUBLIC_OBSERVATION.json NEW_HTTP_REPORT.json
```

The HTTP probe intentionally has a fixed existing loopback/public-fixture route;
it refuses a changed body/range. Local path/manifest inputs stay on this machine.
No app-origin logic, daemon, runtime dependency, CI fallback or production tuning
is added. Token forecast and coding model/settings are uncalibrated/unknown;
provider input/output/cache/reasoning telemetry is unavailable (not zero).
This research unit completes a dated baseline; AWAI-531's broader native/100k-file
acceptance and production optimization remain In Progress.
