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

`vendor/car-source.json` separately pins `awai.fs.car` to owning main revision
`df68aad6101d7bf9587ea48bc30946b834aa4ba2`, landed through
[apex #181](https://github.com/network-awai/network-awai-apex/pull/181).
[apex #180](https://github.com/network-awai/network-awai-apex/pull/180) fixed
the missing DAG-CBOR CID link prefix on #147's branch; #181 extracted only the
reviewed codec, tests, evidence and Otehon CI into main. The vendored module is
byte-identical to that main source and hash-checked by Nix. #147's remaining
runtime/remote/auth changes stay open and are not a consumer dependency.
The earlier measurement pin and final landing have identical codec bytes;
neither establishes production qualification.

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

## Opt-in verified ranges and segmented Zstd-3 (AWAI-531)

The original `read-range`, `read-data`, `export-car`, recovery, writer preflight
and checkpoint retain whole-representation digest checks. A new, explicitly
named `read-range-verified-leaves` API uses positioned reads against a fully
verified recovered snapshot. It rereads and checks the complete touched raw
leaf bytes against their canonical CID digests, then returns the requested
slice. It does **not** scrub unread leaves, framing or headers. Unread damage
still refuses strict export/read/recovery/checkpoint. This scope distinction is
intentional and covered by negative tests; no existing read API silently loses
its whole-CAR corruption check. File type/size/short-read bounds are checked
through one `NOFOLLOW_LINKS` file descriptor per range operation.

`put-data-zstd3!` / `import-car-zstd3!` opt into a versioned *physical*
representation over the exact canonical CAR bytes. The logical DAG, raw leaf
CIDs, root CID, payload hash, CAR framing and interchange/export bytes stay
unchanged. A compressed store contains no duplicate uncompressed CAR. This is
not a new CARv2 dialect and does not change the owning vendored codec/pin.

The physical `.zpack` file starts with eight-byte `AWZP003\n`, a four-byte
big-endian directory length (at most32768), one strict EDN directory and its
contiguous frames. Directory keys: `:format :awai.otehon-store/zstd3-v1`,
`:car-size`, `:frames`. Each frame binds raw offset/size, stored offset/size,
`:encoding` (`:zstd3` or explicit `:raw`), raw SHA-256 and stored SHA-256.
The directory/extents must exactly close; no gaps, overlap, trailing bytes,
unknown fields/tags, padding or external file references. Frame raw size is
64KiB except the final frame; at most16 frames and1MiB total. Zstd-3 uses one
thread; decode has an8MiB window-memory limit, bounded output and a five-second
per-frame process deadline. Nix pins the Zstd executable via `OTEHON_ZSTD`;
raw APIs never spawn it. No JVM/JNI/native language fallback is introduced.

Individual frames stay raw if compression expands them. If the complete
container including its directory is not smaller than the canonical CAR,
publication chooses the existing raw-CAR format and returns that decision in
`:compression`. A failed codec operation refuses instead of silently switching
representations. The new catalog format `:awai.otehon-store/pack-zstd3-v1` binds
canonical CAR/root/payload attributes plus `:stored-sha` and `:stored-size`.
Raw and compressed files can coexist. The same metadata lock and durable
force→rename→directory-sync→WAL/root order publish either representation.
Orphans/partial files are preserved; no migration, compaction or GC occurs.

Recovery verifies the whole stored-byte digest, validates/decompresses every
frame, checks every frame digest/length, then runs the original canonical CAR
validator, rebuilding its root-bound leaf index. Strict export reconstructs
and rechecks exact CAR bytes. Efficient compressed ranges reread and check
selected stored frames even on decoded-cache hits, and then check whole leaf
CIDs. A snapshot-wide LRU retains at most four decoded frames (256KiB); it is
not an admission/state cache. A cache-cold frame requires an external decoder
process, so range CPU/latency tradeoffs must be measured separately from saved
bytes. Fresh-process recovery does not rely on this cache.

Selected independent Zstd frames missing from the cache are concatenated for
one decoder invocation per read, with the sum of expected raw sizes as its
output bound. Each frame's exact raw length and SHA-256 are checked again after
splitting the result; stored frame checks are never skipped. Full recovery and
strict export also batch decoding. This reduces process spawn cost without
changing stored bytes, frame independence or integrity scope.

CLI (existing store, new output paths only):

```sh
otehon-storage pack-put-zstd3 STORE NAME INPUT
otehon-storage car-import-zstd3 STORE NAME INPUT.car
otehon-storage pack-range-verified STORE NAME NEW_OUTPUT OFFSET LENGTH
otehon-storage car-export STORE NAME NEW_OUTPUT.car
```

`pack-range-verified` still does full recovery first; keeping a verified handle
for repeated reads is a library/service integration decision. Standalone CLI
end-to-end latency includes that recovery and must not be compared to repeated
handle reads. The Nix check covers old behavior, new negative range/codec cases,
CLI export/range parity, and30 extra actual process-kill/fresh-process recovery
boundaries for compressed payload/WAL/root/checkpoint publication. None of this
qualifies Native, encrypted private storage, remote providers, distributed
failure tolerance, the installed AwaiVol daemon, or a production cutover.
