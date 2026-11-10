# Otehon hosted checkpoint/WAL adapter

AWAI-532 connects the recovery contract merged in
[network-awai-apex #179](https://github.com/network-awai/network-awai-apex/pull/179)
to real local files. The bounded string-key/string-value metadata store now
publishes immutable Pack/CAR payloads through the same snapshot/WAL boundary.
This is an experimental local Otehon adapter; it has no network service or
Kotoba/Amu native runtime dependency.

`vendor/source.json` pins the exact upstream revision, source path and SHA-256.
`vendor/apex/src/awai/fs/wal.cljc` is a byte-identical dependency snapshot, not
a separate recovery implementation. `default.nix` rejects a changed module
digest. The private upstream archive cannot be fetched anonymously, so this
single-file snapshot avoids credentials and dependency resolution at runtime.
Update it only from the reviewed owning source, with a new revision/digest and
fresh verification. The adapter directly calls `awai.fs.wal/recover`.

`vendor/car-source.json` separately pins `awai.fs.car` at the exact corrected
revision in [apex #180](https://github.com/network-awai/network-awai-apex/pull/180),
stacked on the still-unmerged #147. Its vendored module is byte-identical to
that owning source and hash-checked by Nix. #180 fixes a missing DAG-CBOR CID
link prefix found with an independent IPLD reader; this dependency snapshot
does not imply either upstream PR is merged or production-qualified.

## Pack/CAR publication and recovery

`otehon.pack-store/put-data!` chunks up to 900 KiB into 64 KiB raw leaves and
uses the pinned codec's existing DAG-CBOR root and CID functions. The bounded
wire profile is CARv2 with no optional on-disk index, no padding or nonzero
characteristics, one root after at most 64 raw leaves, and a maximum CAR size
of 1 MiB. Imported CARs must match this exact profile. The source codec's
optional index dialect is not qualified here. Previously emitted nonstandard
DAG-CBOR links lacking the identity multibase prefix refuse; no automatic
format migration or fallback occurs.

Under the metadata writer lock, the adapter verifies current committed Pack
references, writes `<sha256>.car`, forces/renames/syncs it, then publishes its
catalog reference in the WAL/root. The reference binds CAR bytes, root CID,
payload hash, payload size and leaf count. CAR SHA-256 filenames are internal
byte references; the root CID identifies the linked DAG. They serve different
purposes. An interrupted payload remains an orphan until metadata commits;
retry verifies it and completes directory sync. Checkpoint uses the same
reference verification before snapshot/root publication. Missing or corrupt
committed CARs refuse recovery and Pack writes/checkpoints without rollback.

Every `recover` starts with an empty process-local derived-index cache. It
replays committed snapshot/WAL metadata, reads all referenced CARs, validates
every block digest, root links, order and framing, and reconstructs byte-range
indexes from CAR sections. No persistent cache or index sidecar is required.
The handle retains that immutable snapshot basis; recover again to select a
new committed root. Range reads return payload bytes across leaf boundaries
and recheck the durable CAR's byte digest. The current bounded implementation
reads the entire CAR; these are correctness checks, not range-I/O performance
claims. Old CARs and pending files are retained; no garbage collector is added.

The old string-map API remains a low-level metadata interface. Pack callers
must use the Pack operations, including `pack-checkpoint`, rather than writing
reserved `awai.pack/` catalog keys through raw `put`/`delete`/`checkpoint`.

## File and publication contract

Each immutable object is at most 1 MiB and contains either a checkpoint
snapshot or the post-checkpoint WAL. Its filename is the SHA-256 of its exact
EDN bytes. These hashes are internal byte references, not IPLD CIDs, DefCIDs,
signatures or authorization. A root binds both object hashes, checkpoint/tail
sequence and publication generation. The two root slots have a checksummed,
versioned envelope and alternate by generation.

A writer takes a process-held file-channel lock, reconstructs the committed
state through the canonical recovery function, writes objects to unique
temporary files, forces each file, atomically renames it and forces the
directory. It publishes the next root with the same write/force/rename/force
order only after its referenced objects are published. Reusing an object left
by an interrupted rename completes directory sync before root publication.
Success is returned after the root directory sync completes. An error after
root rename can still leave a committed operation: read back before retrying.

Readers verify object bytes and root envelopes before replay. The canonical
function checks snapshot identity by checkpoint sequence and validates the
complete committed WAL interval. The adapter additionally binds exact snapshot
and WAL bytes by hash, validates the string map/operation payloads and requires
the WAL tail to match the selected root. A corrupt newest **referenced object**
refuses rather than silently rolling back. An invalid **root slot** may expose
the older valid root with `:degraded? true`; further writes/checkpoints refuse
until the damaged store is reviewed. Pending files and old objects are retained.

`init` creates a new 0700 directory and refuses an existing path, even a partial
store. Files are created 0600. Symlinked store paths, object reads and lock
opens refuse. This is cooperative single-host locking, not distributed writer
fencing. SHA-256 provides corruption detection/byte binding, not authenticated
identity, encryption, malicious rollback protection or key custody.

## Otehon integration

`base-module.nix` imports `../storage.nix`. Set `otehon.storage.enable = true`
to install `otehon-storage`; the default is disabled. The module neither starts
a daemon nor creates/migrates data. On Otehon, place operational state on the
unlocked encrypted state volume. For a new, disposable candidate store:

```sh
otehon-storage init /var/lib/otehon/awai-fs-candidate
otehon-storage put /var/lib/otehon/awai-fs-candidate example value
otehon-storage checkpoint /var/lib/otehon/awai-fs-candidate
otehon-storage read /var/lib/otehon/awai-fs-candidate
otehon-storage delete /var/lib/otehon/awai-fs-candidate example
```

For synthetic binary files in a disposable candidate store:

```sh
otehon-storage pack-put /var/lib/otehon/awai-fs-candidate example input.bin
otehon-storage pack-checkpoint /var/lib/otehon/awai-fs-candidate
otehon-storage pack-recover /var/lib/otehon/awai-fs-candidate
otehon-storage pack-get /var/lib/otehon/awai-fs-candidate example recovered.bin
otehon-storage car-export /var/lib/otehon/awai-fs-candidate example exported.car
otehon-storage car-import /var/lib/otehon/awai-fs-candidate imported exported.car
```

Input reads are bounded and refuse symlinks. Explicit exports create new 0600
files and refuse existing paths; they do not overwrite user files.

This change does not enable the option in a shipping image, switch an installed
system, touch the existing AwaiVol daemon or migrate its data. The Babashka
dependency belongs only to the Otehon profile.

## Verification

From the repository root:

```sh
nix-build nixos/otehon/storage/check.nix --no-out-link
nix-build nixos/otehon/storage/module-check.nix --no-out-link
```

The first builds the actual CLI, checks metadata and Pack/CAR round trips
through it and runs unit and process-fault tests. The second evaluates enabled/disabled NixOS
configurations and checks that enabling installs the CLI without a daemon.
The runtime and packages use the repository's immutable Nixpkgs pin.

The process driver pauses its own writer after half a file is written, after
the full write, after file sync, after rename and after directory sync. It
covers new WAL/root publication and checkpoint snapshot/WAL/root publication:
25 cases. In each case another process is denied the writer lock, the child is
force-killed, a fresh reader checks exact state/tail/checkpoint, and a later
write/read confirms the killed writer released its lock.

The [2026-11-10 evidence](../../../docs/evidence/awai-532-otehon-storage-20261110/)
records Mac and pinned Linux results, source hashes, upstream byte equality,
commands and the changed-source refusal control. These are hosted process-death
tests with a live OS page cache.

The [Pack/CAR extension evidence](../../../docs/evidence/awai-532-pack-car-recovery-20261110/)
adds 30 process-kill cases covering CAR/WAL/root writes and checkpoint
snapshot/WAL/root writes. After each kill only durable root/object/CAR files
are copied into a new directory, excluding pending files and the lock. A fresh
process starts with zero cache entries, rebuilds indexes and checks exact
payload bytes/ranges. A three-leaf checkpoint-plus-WAL replacement also
round-trips through CAR export/import. Independent IPLD readers verify the
resulting CARv2 envelope, root/leaf links and all block digests.

These are hosted process-death and **empty application-cache** checks. The OS
page cache remains live. They do not establish NixOS boot/VM behavior,
power-loss/device durability, B2/remote restoration, independent-peer recovery,
AEAD/key custody, native qualification, performance thresholds or production
use. The optional package remains disabled in shipping profiles.
