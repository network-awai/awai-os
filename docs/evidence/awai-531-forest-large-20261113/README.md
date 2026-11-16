# AWAI-531: 16 MiB Forest framing study (2026-11-13)

This is a one-host exploratory measurement, not a large-file qualification or a
performance gate. Awai Otehon source: `b041090d0fc1b90b74ff87424a020ed38aa79e79`.
macOS arm64, Babashka 1.12.218, zstd 1.5.7; Forest
`0.39.0+git.7f63144` official macOS archive SHA-256
`a6bc8dac35e3e77b1768fa9b24b4955603f29b5383d705c04fb2bc926483ff69`.
Forest's `car validate` (with block and index validation enabled) passed on all
four output archives. Decoding each archive with zstd produced the matching
input CAR SHA-256 shown below. The corpus is artificial; no real-user file,
random-access latency or actual device recovery was measured.

Each input is exactly 16,777,216 bytes in 256 raw 65,536-byte CIDv1/SHA-256
blocks; CARv1 is 16,787,259 bytes. `pattern` is a reproducible periodic byte
pattern and contains repeated blocks; `random` uses Java Random seed 912331,
not a cryptographic RNG. These are CAR block archives, not Awai logical-file
manifest roots. Input hashes:

| Input | File SHA-256 | CAR SHA-256 |
| --- | --- | --- |
| pattern | `399a2c42f2f5323892969ade67e1ae50e6d0697b9026f653788eb24c6068c911` | `634b5347560444de9d69f7f04ddd1e1c355d2340dcd0a37efdea462cdf0e68c6` |
| random | `f95393dbbe36c8560376d39d5b38df32e70a0b6b545d47d6e1e23213870c5a7e` | `90b2ffcea5dea60ac43d37efc41e48b450c466251d3829d00ffbc709ebe3614f` |

| Dataset | Forest frame tripwire | Forest bytes | Data frames | Index bytes |
| --- | ---: | ---: | ---: | ---: |
| pattern | 8,192 | 74,280 | 9 | 5,176 |
| pattern | 65,536 | 148,405 | 3 | 5,176 |
| random | 8,192 | 16,795,564 | 256 | 5,208 |
| random | 65,536 | 16,795,564 | 256 | not separately measured |

The extra header frame and two skippable frames are excluded from the data
frame counts. `frame-size` is a *compressed-output tripwire*, not a bound on
uncompressed bytes: for pattern/8,192, individual frames decoded to 393,450–
2,163,975 bytes; for pattern/65,536, 2,426,275–7,278,825 bytes. In this one
corpus, the larger setting produced a larger archive; the cause has not been
established and the result is not a general compression ranking. A whole-CAR
`zstd -3 -T1` produced 160,219 and 16,787,660 bytes respectively, but does not
by itself supply the Forest CID index.

The present Otehon reader rejects the pattern/8,192 archive even though its
compressed size is below 1 MiB: an individual expanded frame exceeds the
bounded decoder. The random archive exceeds the 1 MiB input bound. In addition,
Otehon Pack caps data at 900 KiB and reconstructs/validates the entire archive
on recovery. No large-file write or range read through Awai was demonstrated.

Before extending the path, preserve Kotoba's existing logical chunk profile and
manifest identity; define a separate bounded physical pack/Forest layout. Bound
both compressed and decoded frame sizes and block count; a Forest compressed-size
tripwire alone is insufficient. Partition existing blocks without silently
rechunking, publish pack and index before the root, verify selected frames and
CIDs, and keep strict full recovery/scrub distinct from range reads. Test
cross-pack ranges, missing/altered packs and indices, process stops and restart;
OS-cache loss, real power loss and Native remain separate. A cap, cache policy,
index memory strategy, scalable recovery and benchmark thresholds are not
approved by this observation.

## Reproduction

Requires `bb`, `zstd` and the pinned Forest executable obtained and digest
verified independently. Run at the repository root, with enough disposable
space; generated inputs and archives stay in `.agent-output/large-study/`.
The scripts do not remove generated data. Replace `$FOREST_TOOL` with the
verified executable path.

```sh
mkdir -p .agent-output/large-study
bb --classpath nixos/otehon/storage/vendor/apex-car/src docs/evidence/awai-531-forest-large-20261113/gen.clj
for kind in pattern random; do
  for size in 8192 65536; do
    "$FOREST_TOOL" snapshot compress ".agent-output/large-study/$kind.car" \
      --output-path ".agent-output/large-study/$kind-$size.forest.car.zst" --frame-size "$size"
    "$FOREST_TOOL" car validate ".agent-output/large-study/$kind-$size.forest.car.zst"
    zstd -q -dc ".agent-output/large-study/$kind-$size.forest.car.zst" | shasum -a 256
  done
done
```

The recorded file names used `-8k` and `-64k` rather than `-8192` and
`-65536`. Pass the desired filenames to `frame-sizes.clj`, saving its output as
`.agent-output/large-study/frames.edn`, then run `decoded-sizes.clj` to decode
the pattern data frames individually. These inspection scripts do not validate
the format or replace Forest's validator.
