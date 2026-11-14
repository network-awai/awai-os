# File-backed Forest frame verification — 2026-11-13 UTC

The hosted reader now passes byte arrays through file-backed frame parsing,
hashing and selected-block reads instead of boxing every payload byte into a
Clojure vector. It retains the owning CAR codec for section length and CID
parsing, canonical framing and CID checks, whole-frame checks, and bounded
frame decoding. This changes no persisted format or Native execution path.

A local before/after check used the same 16 MiB incompressible-data Forest
archive (SHA-256 `063b7ea3bba66e4b9f88818b2ab8584cf860cdef422f90df567dd79aa5e1de77`),
one full `verify-file` then 16 positioned CID reads totalling 16,777,216 bytes.
Both variants returned all 16 verified blocks. On macOS Darwin 25.4.0 arm64,
Babashka 1.12.218 and `/usr/bin/time -l`:

| Run order | Version | Verify ms | Read ms | Elapsed s | Max RSS bytes |
|---|---:|---:|---:|---:|---:|
| 1 | baseline `d58c60c` | 9820 | 9810 | 19.73 | 732708864 |
| 2 | candidate | 718 | 316 | 1.08 | 141541376 |
| 3 | candidate | 782 | 309 | 1.21 | 125140992 |
| 4 | baseline `d58c60c` | 10020 | 9591 | 19.67 | 770342912 |

These are two samples per version of one local fixture, not a throughput
qualification: OS cache was not cleared, other local tests overlapped runs,
and the small sample does not isolate scheduling or cache effects. RSS is the
process maximum reported by `time`, not an allocation counter. The previous
1 GiB sparse process test predates this change and is not an after measurement.
The large-writer proof separately wrote and restored a 17 MiB fixture over two
Packs and compared the entire SHA-256 and a cross-Pack range.

`forest_file_frame_bench.clj` accepts `FOREST_BENCH_FILE`, and requires a
content-addressed `<sha>.forest` file plus the Otehon storage classpath. Run
each candidate and baseline in fresh processes using the same input; baseline
source can be supplied as an earlier classpath overlay. This is a local hosted
measurement, not an OS-cache-loss, power-loss, Native or production claim.
