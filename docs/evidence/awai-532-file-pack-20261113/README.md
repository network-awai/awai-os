# AWAI-532: file-backed Forest Pack publication, 2026-11-13

The Otehon file input path checks each bounded Forest Pack without retaining
all Pack byte arrays. It binds the canonical logical manifest to verified leaf
indexes, re-reads each source under the writer lock and checks its length and
SHA-256 before saving the immutable object, then publishes one WAL/root. The
existing maximum of 64 Packs and 900 KiB payload per Pack remains unchanged.
Existing catalog recovery may retain index metadata for committed Packs; this
experiment did not measure peak RSS and is not a GiB-scale qualification.

Local macOS, Babashka 1.12.218, pinned Otehon vendor sources; output directory
is new and isolated from live stores:

```sh
AWAI_FILE_INPUT=1 bb --classpath nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/test nixos/otehon/storage/test/otehon/atomic_logical_proof.clj run .agent-output/file-pack-atomic-final-20261113
```

The eight existing writer-kill boundaries passed, with old or new root as
appropriate, retry and a cross-Pack range check. An additional input-mutation
case changed the second copied source after the first immutable object was
synced: publication rejected it as `:forest-changed` and the root was
unchanged. Outputs concluded `{:changed-input :rejected :root-unchanged true
:pass true}` and `{:cases 8 :cross-pack-range true :negative-cases true :pass
true}`. The local output log and stores are retained under `.agent-output`.
Process termination and copied records do not demonstrate host OS cache loss,
power failure, independent nodes, real policy, Native execution or deployed
AwaiVol behavior. Source files must remain accessible throughout the two
passes; incomplete immutable objects may remain as unreferenced orphans.

Existing storage and Pack unit suites also passed locally: 24 tests, 145
assertions, zero failures/errors. `check.nix` now runs the file-input crash
proof in addition to the existing byte-array proof. Nix was not installed on
this macOS host, so the Nix derivation and its CI result were not locally
verified.

## Local comparison, 2026-11-13

A single local macOS host, Babashka 1.12.218, same deterministic 2 MiB /
4-Pack fixture, fresh store per run; the timer includes store initialization,
manifest construction and publish, excludes fixture loading and process start.
Three byte-array/file pairs were run in that order. Elapsed milliseconds:

| run | byte-array | file |
| --- | ---: | ---: |
| 1 | 3965.264 | 3732.810 |
| 2 | 3817.740 | 3739.220 |
| 3 | 3839.804 | 3751.796 |

Each reported the same canonical manifest CID
`bafyreidqkmghsd65dwq22umpkrqecyamfhevsbq7xemjfe7tb6wnhvxsny` and four Packs.
The benchmark driver preloads the source fixtures for both modes, so it cannot
measure the memory benefit of file inputs. OS and application caches were not
controlled, there are only three paired samples and fixed ordering may bias
results. These numbers neither establish a performance improvement nor predict
GiB behavior.

```sh
for n in 1 2 3; do
  AWAI_FILE_INPUT=0 bb --classpath nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/test docs/evidence/awai-532-file-pack-20261113/bench.clj ".agent-output/bench-memory-$n"
  AWAI_FILE_INPUT=1 bb --classpath nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/test docs/evidence/awai-532-file-pack-20261113/bench.clj ".agent-output/bench-file-round-$n"
done
```

## Read-only fixture follow-up

The Nix `otehon` check on PR head `6964923` failed the input-mutation case;
the old test swallowed non-`:forest-changed` exceptions, so its log did not
identify their type. On macOS, `Files/copy` from a `0444` source produced a
`0444` target, while writing a new target from the same bytes produced `0644`.
The test now creates its own writable copy and rethrows unexpected exceptions.
Using copies of all four source fixtures made read-only (`0444`) as
`CROSSPACK_FIXTURES`, the full file-input proof again passed its eight process
kill cases and `:changed-input :rejected, :root-unchanged true`. This tests the
identified permission behavior locally; the Nix CI rerun is still required.

## CLI path

The Otehon CLI accepts `logical-forest-import STORE NAME MANIFEST CID PACK...`
and `forest-group-range STORE NAME OUTPUT OFFSET LENGTH`. A separate-process
CLI proof imports the four fixture Packs, rejects a wrong manifest CID and a
symlink Pack source without publishing a root, verifies a 40-byte range across
the Pack boundary, and refuses to overwrite the output. Babashka 1.12.218 on
this host returned `:cross-pack-range true`, `:bad-cid-rejected true`,
`:symlink-rejected true`, `:overwrite-rejected true` and `:pass true`:

```sh
bb --classpath nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/test nixos/otehon/storage/test/otehon/cli_logical_proof.clj .agent-output/cli-logical-proof-final-20261113
```

This is an Otehon hosted CLI using prebuilt Forest archives; it does not generate
Forest archives from user files or change any GiB, Native or cache-loss limits.

## Raw file to Forest integration experiment

On 2026-11-13 a local hosted reference driver generated a deterministic 2 MiB
file, read it in 512 KiB batches, used the pinned Awai CAR codec to form four
CARv1 files, converted them with the official Forest 0.39.0 tool, and passed
those files and a canonical logical-file manifest to the product's file-backed
atomic group importer. A separate Babashka process reopened the resulting
store and read all 2 MiB through group range reads: bytes matched and the
manifest CID was
`bafyreidqkmghsd65dwq22umpkrqecyamfhevsbq7xemjfe7tb6wnhvxsny`.
This uses a **reference driver**, not a product file-to-Forest writer. It is
not a GiB, Native, OS-cache-loss, physical-power-loss, or performance test;
the driver generates and compares a whole in-memory test corpus and reads the
entire tool binary to hash it. The first draft unnecessarily boxed the tool
bytes and reached about 3.5 GiB RSS before finishing; the recorded final driver
hashes the existing byte array directly. No bounded total-RSS claim is made.

The macOS arm64 release archive matched the earlier recorded SHA-256
`a6bc8dac35e3e77b1768fa9b24b4955603f29b5383d705c04fb2bc926483ff69`;
the extracted executable SHA-256 was
`e5fb23076a46c055142b3dbf3efa1ad5a68532d14419ad9994785986719b205f`.
The observed Linux amd64 archive and binary hashes were respectively
`81224a9efed00353ec3c6cc5197f26abfdf48ed9458c1ce72b612e825d5bb64a` and
`7af03845db7324da80c5bc2848fe6897303b39cbac8bb701675e57ad82033ba0`;
the latter matches the checksum inside that same archive, not an independent
verification. The Linux binary was not executed. Neither binary is included in
the product or silently used as a Native fallback.

```sh
bb --classpath nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src docs/evidence/awai-532-file-pack-20261113/raw-forest-proof.clj .agent-output/raw-forest-proof-final-20261113 "$FOREST_TOOL"
```

The output directory must not already exist; `FOREST_TOOL` must name the exact
macOS executable above. Output included `:source-bytes 2097152`, `:packs 4`,
`:chunks 32`, `:bytes-equal true`, `:pass true`. Independent-process restore
reported `:separate-process true`, `:bytes 2097152`, `:equal true`.

Separate-process readback:

```sh
bb --classpath nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src docs/evidence/awai-532-file-pack-20261113/raw-forest-read.clj .agent-output/raw-forest-proof-final-20261113
```

## Bounded Otehon raw-file writer

`forest-file-put STORE NAME SOURCE NEW-STAGING-DIR FOREST-TOOL` reads a regular
source with a fixed 64 KiB logical chunk profile, assembles up to 14 chunks per
Pack and publishes up to 64 Packs as one root. The explicitly supplied tool must
match a hard-coded 0.39.0 executable digest; it is copied into a private new
staging directory, hashed again and executed from there. The directory, including
that large tool copy and generated CAR/Forest files, is retained for inspection.
The source is never deleted. A before/after size and mtime check detects ordinary
source changes; it is not a filesystem snapshot or proof against same-size
changes with restored timestamps.

Using the macOS arm64 artifact above and Babashka 1.12.218, the product writer
and CLI imported the deterministic 2 MiB file into three Packs; the logical
manifest CID matched the previous four-Pack representation. A separate process
restored all bytes. The hosted proof also verified rejection of an unpinned
tool and interruption after the first Forest rename without root publication:

```sh
bb --classpath nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src nixos/otehon/storage/test/otehon/forest_writer_proof.clj .agent-output/raw-product-proof-20261113 "$FOREST_TOOL"
```

Output: `:bytes 2097152`, `:packs 3`, `:logical-cid-match true`,
`:untrusted-tool-rejected true`, `:interrupted-root-unchanged true`,
`:roundtrip true`, `:pass true`. The CLI readback in another process matched
all bytes. Existing unit suites passed 24 tests / 145 assertions and the new
unpinned-tool unit test passed 1 test / 3 assertions. The Nix check contains
that negative unit test, but the actual Forest-tool positive proof is not yet in
Nix CI. The Linux artifact digest remains an observation without independent
verification. This writer rejects empty inputs and files above 56 MiB; it does
not implement GiB support, Native I/O, OS cache loss, physical power loss, real
policy/receipt, or a consistent snapshot of a concurrently changing source.

### Concurrent source change check

With the same hosted artifact, `forest_writer_proof.clj` additionally waited
until the first CAR appeared and appended one byte to the test-owned source
while the writer was still active. The writer returned `:source-changed` and
the isolated store's root stayed unchanged. The full proof returned
`:changed-source-rejected true`, along with the prior positive, unpinned-tool
and injected-interruption checks. This covers an observable size change; it
does not turn the before/after size and mtime check into an immutable snapshot.
