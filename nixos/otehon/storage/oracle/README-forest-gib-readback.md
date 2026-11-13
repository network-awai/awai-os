# 1 GiB Forest readback after frame allocation change — 2026-11-13 UTC

A fresh hosted Babashka process running `b159260` recovered the preserved
AWAI-532 local 1 GiB logical-file fixture, verified all 64 distinct Forest
Packs from an empty process-local index cache, and read all 1,024 MiB ranges.
The concatenated output SHA-256 and a fresh full input-file SHA-256 were both
`dd4ec50fea8f5a68daf225da4945af367e25bb870a09346060fa9dc088c001b0`.
The readback reported 64 index rebuilds, 1,024 positioned Forest frame reads,
and 269,026 compressed bytes read. The input is a highly compressible sparse
fixture with per-leaf markers; these compressed byte counts are not evidence
of 1 GiB of physical storage or device throughput.

Babashka 1.12.218 on Darwin 25.4.0 arm64, measured with `/usr/bin/time -l`:
Two separate runs took 67.49 s and 67.38 s elapsed, each including source
hashing, recovery and full readback; both reported 131,055,616 bytes maximum
resident set size. The earlier pre-change run of the
same fixture reported about 976 s and sampled process RSS at least 5,929,472
KiB. Its measurement method and system conditions differ; neither run controls
OS cache or competing workload, so this is a useful observation rather than a
controlled performance qualification. The current change did not rewrite the
fixture or create a new 1 GiB Pack set.

For a preserved fixture directory containing `input.sparse` and `store`, set
`FOREST_GIB_FIXTURE` to its absolute path and run
`forest_gib_readback.clj` with the Otehon storage source and both vendored codec
source directories on the Babashka classpath. The reader validates source size,
computes the input hash anew, restores the committed group `gib`, requires 64
distinct Packs, and compares the full recovered data hash. No cache dropping,
OS restart, power interruption, Native I/O, multi-node storage or production
qualification is established by this experiment.
