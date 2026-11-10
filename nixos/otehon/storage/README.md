# Otehon hosted checkpoint/WAL adapter

AWAI-532 connects the recovery contract merged in
[network-awai-apex #179](https://github.com/network-awai/network-awai-apex/pull/179)
to real local files. This is an experimental, bounded string-key/string-value
store used to establish the snapshot/WAL publication boundary. It is not a
Pack/CAR filesystem, a network service or the Kotoba/Amu native storage route.

`vendor/source.json` pins the exact upstream revision, source path and SHA-256.
`vendor/apex/src/awai/fs/wal.cljc` is a byte-identical dependency snapshot, not
a separate recovery implementation. `default.nix` rejects a changed module
digest. The private upstream archive cannot be fetched anonymously, so this
single-file snapshot avoids credentials and dependency resolution at runtime.
Update it only from the reviewed owning source, with a new revision/digest and
fresh verification. The adapter directly calls `awai.fs.wal/recover`.

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

This change does not enable the option in a shipping image, switch an installed
system, touch the existing AwaiVol daemon or migrate its data. The Babashka
dependency belongs only to the Otehon profile.

## Verification

From the repository root:

```sh
nix-build nixos/otehon/storage/check.nix --no-out-link
nix-build nixos/otehon/storage/module-check.nix --no-out-link
```

The first builds the actual CLI, checks put/read/checkpoint through it and runs
unit and process-fault tests. The second evaluates enabled/disabled NixOS
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
tests with a live OS page cache. They do not establish NixOS boot/VM behavior,
power-loss/device durability, independent-peer recovery, Pack/CAR/encryption
integration, native qualification, performance thresholds or production use.
