# AWAI-532 Pack/CAR persistence and empty-cache recovery — 2026-11-10

Candidate repository: `network-awai/awai-os`, branch
`codex/awai-532-pack-car-recovery`, base `58ff5a733eb28233681702f232bb5d937df732ca`.
Tracking: https://linear.app/kotobalabs/issue/AWAI-532 .
Codex chat: `01a1c403-4751-72d2-84de-55853fc89649`.

## Implemented boundary

The Otehon hosted adapter stores real bounded CARv2 Pack bytes before publishing
their references through the existing checkpoint/WAL/A-B-root transaction.
Writer lock, file force, atomic rename and directory force cover CAR and
metadata publication. Orphan CARs remain invisible and can be verified/reused
on retry. Missing/corrupt committed CARs refuse recovery and Pack mutations;
metadata must not silently roll back or publish a replacement over the error.

`otehon.pack-store` reuses the owning `awai.fs.car` module for CID, CBOR, CAR,
Pack assembly and range sections. WAL and CAR source pins are separate. The
CAR source is byte-identical to apex commit
`a9c676ffe37e4814a786a3d2c57d7cbdaedb0a2e`, SHA-256
`6c11cf9d1022b628fce73c2ac8de589667f9d277e0ae69ad52742fc9bebf148b`, in
[apex #180](https://github.com/network-awai/network-awai-apex/pull/180), stacked
on still-open #147. The module is a hash-pinned dependency snapshot; those PRs
are not represented as merged or fully reviewed by this work.

The bounded profile omits CARv2's optional on-disk index. It stores the existing
raw-leaf/DAG-CBOR-root Pack, and rebuilds derived indexes from verified sections.
Imports require the exact closed profile, one root, no padding/characteristics,
at most 64 leaves, payload <=900 KiB, CAR <=1 MiB. Locally generated leaves are
64 KiB. This does not qualify the owning source's optional index dialect.

Recovery replays committed metadata, verifies every referenced CAR's byte
digest, each block CID digest, root/leaf links, ordering/framing and reference
attributes, then rebuilds an empty process-local index cache. A handle has an
immutable snapshot basis. Reads verify durable CAR bytes again; current range
reads load a full bounded CAR, so this is not a selective-I/O benchmark.

## Measurements

Final corrected-source results:

| Environment | Result |
| --- | --- |
| macOS arm64 / Babashka 1.12.218 | 17 unit tests, 70 assertions, 0 failures/errors; 30 Pack process-kill cases; 1 multi-leaf checkpoint/WAL/export/import case |
| Nix Linux aarch64 / Babashka 1.12.218 | Same unit/Pack cases plus all 25 original metadata crash cases; packaged CLI put/checkpoint/recover/get/export/import and binary `cmp` pass |
| Nix module boundary | Enabled/disabled evaluations pass: package opt-in, no storage service, disabled by default |
| Independent Node v26.0.0 oracle | `@ipld/car@5.4.7` and `@ipld/dag-cbor@10.0.2` read both Mac and Nix CARv2 files, verify every block digest and DAG-CBOR link, and recover byte-identical data |
| Negative source-pin control | Appending one newline to a disposable copy of the vendored CAR source fails the Nix hash assertion before building |

Each process-kill case pauses its own child after half-write, full-write,
file-force, rename or directory-force, for CAR/WAL/root writes and checkpoint
snapshot/WAL/root writes (6 roles x 5 boundaries). A concurrent process is
denied the writer lock. The writer is force-killed (exit 137), only regular
durable root/EDN/CAR files are copied to a new 0700 directory, excluding pending
files and the lock, and a new reader process verifies the exact published
tail/checkpoint, payload and byte range. Original store retry confirms lock
release and orphan reuse. Before root rename the prior committed bytes remain
selected; after root rename the new commit is visible under process death.

The dedicated 3-leaf case writes an old Pack, checkpoints it, then replaces it
via WAL (checkpoint=1, tail=2). Durable-only restore selects the new Pack,
starts with cache entries=0, rebuilds one index, reads all 131,085 bytes and a
range crossing byte 65,536, exports/imports the identical CAR into another new
store, and repeats in a fresh process. Old CARs are retained but not selected.

The final Mac and Nix CARs are byte-identical:

- CAR: 131,480 bytes; SHA-256 `8ecf39755b177e6535bff36d2456b8a6ec5d65617cf8b960d18d88d87126fd14`
- Root CID: `bafyreiev2vnsudyn4uz7ybmhcddcy2p6mlwzvdtajkcsrioz375izrrcc4`
- Payload: 131,085 bytes; SHA-256 `d4fb8c638bb3deb8e3d5db33dbc8a3eb7281f90d4d0f012d29c98dd919058315`

The source's own initial round trips passed, but the independent IPLD reader
found tag 42 CID links missing the required leading `0x00`; see
`oracle-before.stderr`. The fix lives in the owning apex PR #180, not a
consumer-local codec fork. All final results above were rerun against its pin.

## Reproduction and downloaded artifacts

From the repo root (output directories must be new):

```sh
bb --classpath nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/test -e "(require '[clojure.test :as t] 'otehon.storage-test 'otehon.pack-store-test)(let [r (t/run-tests 'otehon.storage-test 'otehon.pack-store-test)] (System/exit (+ (:fail r) (:error r))))"
bb --classpath nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/test nixos/otehon/storage/test/otehon/pack_recovery_runner.clj run .agent-output/pack-crash
nix-build nixos/otehon/storage/check.nix --no-out-link
nix-build nixos/otehon/storage/module-check.nix --no-out-link
```

The Mac host used Podman Linux aarch64 for the Nix commands, mounted at `/work`,
with the persistent `awai-otehon-nix` Nix cache and immutable image
`docker.io/nixos/nix@sha256:7a70027ba790d3a79fa82faeac5f3dddc048f89e83b3901ca69542c340c9fb5c`.
Nix 2.28.4; repository Nixpkgs pin
`f5c082a40f7571c266e74e80ae2e68aadd8a9fc7`. Final check output:
`/nix/store/2wm417h7alf140y96bvdij766bpmwagj-otehon-storage-hosted-check`.
The existing pinned package dependencies came from that cache; the log records
only two newly built derivations (CLI and test output), no runtime tool added.

The one-off independent oracle downloaded only five npm packages; their exact
versions, tarball URLs and integrity hashes are in `oracle-packages.json`.
This oracle is not a runtime, build, gate or CI dependency:

```sh
npm install --prefix .agent-output/car-oracle --no-save --ignore-scripts --no-audit --no-fund @ipld/car@5.4.7
cp docs/evidence/awai-532-pack-car-recovery-20261110/oracle.mjs .agent-output/car-oracle/
node .agent-output/car-oracle/oracle.mjs .agent-output/pack-crash/multi-leaf.car .agent-output/pack-crash/multi-leaf.bin
```

Synthetic input is exactly `data :large` in `pack_recovery_runner.clj`:
131,085 bytes, byte i = `(19*i + floor(i/8191)) mod 256`. No operational data,
credentials or network storage is used. `source-sha256.txt` binds checked code;
machine-readable Mac/Nix case logs, CLI output, oracle and module results are
alongside this file. `git show <pin>:src/awai/fs/car.cljc | cmp - <vendor-file>`
confirmed dependency byte equality. The hash negative control copies only the
storage package to scratch, appends one newline to its CAR module, and evaluates
that package with pinned `pkgs`; `car-pin-negative.stderr` records rejection.

## Qualification still open

This is an empty **application-cache**, fresh-process, hosted disk-backed test.
The OS page cache is live. It does not simulate machine power loss or dropped
device writes, boot a NixOS VM, restore from B2/remote storage, qualify AEAD/key
custody or distributed peers, implement POSIX/FUSE, measure acceptance latency,
or establish native/physical-device/production readiness. The package remains
opt-in and disabled by default. No daemon, operational volume, shipping image
or production route was changed. AWAI-532 remains In Progress.
