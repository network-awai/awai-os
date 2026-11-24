# Draft claim rows — measurement rig (M1–M4)

Draft rows in the [contribution record](contributions.md) format. Not admitted:
bot-measured only, awaiting human research-lead admission. Numbers come from
`docs/research/simulator/measure.py`; the run outputs are in
`docs/research/measurement/`. See [measured-baseline.md](measured-baseline.md)
for the protocol and the falsification conditions.

| Claim ID | Manuscript wording (proposed) | Operator / measurer | Researcher contribution (bot) | Bot verification date (JST) | Command / review method | Source revision + citation | Independent reviewer + readback | Final decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MEASURE-CANON-INVARIANCE | Canonical JSON serialisation is invariant to key order and indentation: 120 of 120 repository JSON files hash identically under both permutations. MEASURED (240/240 checks). | Bot (synthetic rig) | Built the rig, ran it twice, confirmed identical output | 2026-11-24 | `python3 docs/research/simulator/measure.py --corpus . --block 4096 --out docs/research/measurement/measure-out-b4096.json` → `M1_determinism.invariance_rate = "240/240"` | `481ab9e0`; `measure-out-b4096.json` | Pending | Not yet admitted (draft) |
| MEASURE-DEDUP-CORPUS | Content-addressed dedup over 120 repository JSON files (4,027,805 B) saves 0.51% with 4 KiB fixed blocks and 2.42% with content-defined chunking. MEASURED. | Bot (synthetic rig) | Built the rig, ran it at 4096 and 512 B block sizes | 2026-11-24 | same command → `M2_storage.dedup_ratio_fixed = 0.005050`, `dedup_ratio_cdc = 0.024198` | `481ab9e0`; `measure-out-b4096.json`, `measure-out-b512.json` | Pending | Not yet admitted (draft) |
| MEASURE-DIFFSYNC-CDC | Over 15 revisions of `android/build.py` (52,233 B), diff-sync transfers 73.1% of full-sync bytes with fixed 512 B blocks and 12.5% with content-defined chunking. MEASURED. | Bot (synthetic rig) | Built the rig, read the git history directly with `git show` | 2026-11-24 | `python3 docs/research/simulator/measure.py --corpus . --block 512 --history-file android/build.py --out docs/research/measurement/measure-out-b512.json` → `M3_network.mean_ratio_fixed = 0.731331`, `mean_ratio_cdc = 0.125192` | `481ab9e0`; `measure-out-b512.json` | Pending | Not yet admitted (draft) |
| MEASURE-DIFFSYNC-SMALL | On `android/online-pins.dev.json` (5,700 B, 8 revisions) diff-sync saves nothing at 4 KiB blocks: fixed 100.0%, CDC 99.9%. MEASURED. | Bot (synthetic rig) | Built the rig; the document is smaller than a few blocks, so both chunkers degrade to whole-file transfer | 2026-11-24 | `--block 4096 --history-file android/online-pins.dev.json` → `M3_network.mean_ratio_fixed = 1.000000`, `mean_ratio_cdc = 0.998797` | `481ab9e0`; `measure-out-b4096.json` | Pending | Not yet admitted (draft) |
| MEASURE-COST-CANON | Canonicalising 4,027,805 B of JSON costs 0.029 s wall clock at 135–137 MB/s with 78 MB peak RSS on this host. MEASURED-ONCE. | Bot (synthetic rig) | Built the rig; timing is host-specific and excluded from the reproducibility check | 2026-11-24 | same commands → `M4_cost.wall_seconds = 0.02936`, `mb_per_second = 137.187`, `peak_rss_bytes_after = 77692928` | `481ab9e0`; `measure-out-b4096.json` | Pending | Not yet admitted (draft) |

Scope note: these rows measure the storage and transport layer of a
content-addressed design. They do not measure, and must not be cited as evidence
for, the performance of any candidate mathematical system. No reference
implementation of the candidates exists in this repository.
