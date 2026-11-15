# Bounded Otehon volume v1 (2026-11-10)

This is a Linux hosted comparison implementation, not Native qualification or
production certification. Kotoba/Amu own canonical codecs, CIDs and primitives;
this adapter consumes the admitted indexless CARv2/Pack profile in README.md.
The fixed logical chunk profile is a local admission/compatibility record;
canonical owning schema and Native parity remain AWAI-531 follow-up work.
AWAI-173/174 continue to own private tree and query semantics.

Build `ci/otehon-volume.nix` with the pinned source in
`ci/otehon-nixpkgs.nix`, then run `bin/awai-otehon-volume COMMAND ROOT ...`.
The closure contains Node 22.23.3, nbb 1.4.208 and import-meta-resolve 4.2.0,
with fixed source hashes, isolated nbb config, curl and util-linux flock.
`npm run test:otehon` runs the independent hosted checks on Linux with Nix.
No Native build/gate depends on this runtime. The launcher holds an exclusive
OS flock for the full CLI/server process; concurrent commands fail with 75.
The runtime implementation and the lock file are trusted host infrastructure,
not an adversarial capability or distributed fencing mechanism.

## Supported records and limits

- `init ROOT [LEAF_SIZE]` creates a new, empty v1 volume. Existing nonempty
  directories and legacy `manifest.json`/journal volumes are refused. There is
  no implicit migration, fallback or live-daemon cutover. Both root slots are
  initialized before acknowledgement; a missing slot or generation gap refuses
  subsequent recovery instead of silently exposing an older state.
- Input file: at most 8 MiB, at most 1024 fixed logical leaves. Persisted leaf
  profile is preserved on replacement and repack. No implicit rechunk operation.
- Indexless Pack: at most 16 MiB, admitted raw/SHA-256 leaves and Pack root,
  exact bytes/root CID/whole-Pack checksum and every referenced leaf verified.
  Media changes select physical targets and can explicitly migrate full Packs.
- Catalog: at most 1024 names and Packs; aggregate file bytes and Pack bytes
  each at most 64 MiB. Management object: at most 1 MiB. These are implementation
  resource bounds, not performance or production acceptance thresholds.
- Total regular-file bytes (including pending/orphan/checkpoint evidence): at most
  128 MiB and 8192 directory entries. Writes refuse at the bound; they do not
  discard evidence. Management-history collection is not implemented.
- Root format `awai.otehon.volume-root.v1`, checkpoint
  `awai.otehon.volume-checkpoint.v1`, WAL `awai.otehon.volume-wal.v1`, catalog
  `awai.otehon.catalog.v1`. JSON SHA-256 references identify management bytes;
  they do not redefine canonical block identity. Exact snapshot/WAL/catalog
  references and generation are bound by the root envelope. Pack descriptors
  contain physical index, byte length, checksum and canonical root CID. Files
  retain ordered logical chunk hashes, raw whole-file CID and content-root
  CID/bytes, independently of physical Pack locations.

## Publication, recovery and collection

Each transaction writes immutable Pack bytes, forces the file, renames it and
forces its directory. It then writes checksum-named WAL and checkpoint records
with the same force/rename/directory sequence, followed by one A/B root slot.
Every acknowledged write checkpoints; no batching or performance benefit is
claimed. Pending files and orphans remain evidence and their Pack IDs are never
reused. Derived `.idx` files are ignored. Exports use create-new, not overwrite.

Recovery chooses the committed generation and verifies its exact dependencies.
A missing/corrupt Pack, snapshot or WAL, unsupported version, invalid CID/link,
or damaged root slot refuses service and writes; it does not silently select an
older visible state. GC checkpoints first and retains the union of both root
catalogs; corrupt retained references block collection. It never deletes remote
objects. Shared file aliases remain readable when another name is removed.

`sync ROOT BACKEND SNAPSHOT` sends actual verified Packs before an immutable
manifest snapshot, reads every object back, and binds retry identities to
backend/object/content. A receipt says **backend-acknowledged**, not replicated
policy or hardware durability. `evict` verifies every selected backend copy
before removing local Pack cache. `fetch` restores missing Packs against the
committed byte length/checksum/profile. Corrupt local committed bytes refuse
instead of silently taking another source. The cold-cache test keeps management
records and removes every local Pack plus all in-process caches. It is not a
whole-volume backup discovery/restore protocol. Live B2 was not exercised.

## Local HTTP boundary

`serve ROOT 0` binds loopback and prints the selected ephemeral port.
`AWAI_VOL_TOKEN` is required (at least 16 non-whitespace characters); optional
`AWAI_VOL_TOKENS=name:secret,...` requires unique names and secrets. Every request
requires authentication; named principals need explicit per-file read/write
ACL grants. Owner-only stats/GC, source-read COPY, destination-write admission,
collection denial and invisible denied names precede mutation. Range requests
accept one complete safe-integer extent only. This guard is not dango, AEAD or
private-tree authorization qualification.

WebDAV advertises class 1 only. LOCK/UNLOCK, explicit MKCOL and HTTP PROPPATCH
refuse with 501. There is no fabricated exclusive lock token or partial XML
mutation. Local bounded propset/propdel remain available; property text is
escaped on output. Legacy mount supervisor and launchd installer are disabled
in this candidate; no existing deployed service was changed.

## Evidence boundaries and next work

The pinned process driver uses its own disposable directories, ephemeral ports
and child process groups. It covers media repack/alias/ranges, empty cache restore,
missing/corrupt references, unknown versions, every Pack/WAL/checkpoint/root write
at half-written/written/file-synced/renamed/directory-synced boundaries, competing
writer rejection and restart/retry. HTTP denial must leave committed roots intact.
A durable-only copy removes derived/pending data before a fresh process reads it.

These are **process-stop and application-cache** results. OS reboot losing cache,
physical media power loss and independent node loss require separate tests.
No performance threshold, GPU kernel, Native artifact, independent node receipt,
distributed epoch/fencing, actual EC repair, remote GC, consensus, full backup
restore, full UnixFS/GraphSync interop, signed frontier, dango/AEAD or production
acceptance is established here. AWAI-531/532 stay open for the remaining owning
schema/corpus/native/hardware gates; AWAI-534 follows single-node acceptance.
CPU/RAM/GPU/optimizer work (AWAI-533/535) remains record-only and follows correctness.
