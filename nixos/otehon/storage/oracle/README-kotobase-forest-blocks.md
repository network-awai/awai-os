# Hosted Kotobase Forest block port

`otehon.kotobase-forest-blocks/open-block-store` implements the pinned
Kotobase `IBlockStore`; `open-backend` composes it with the Otehon ref port.
A nonempty bounded put validates and owns every CID/byte pair before any
publication, sorts/deduplicates by CID, and writes one immutable batch group
through `put-ipld-blocks!` with an expected store generation. A conflicting
local writer causes a bounded retry. The entire batch becomes visible through
one WAL/root publication; older batches are retained. A repeated identical
batch validates existing bytes and does not advance the root. Empty input is a
no-op. The current limits are 850 KiB per block, 32 MiB per input batch and
4,096 input entries; archive bounds still apply and may reject earlier.
Returned CID order matches the caller's input. Byte arrays and unsigned byte
vectors are accepted. Staging is private and retained on success, stale
retry or failure. An ambiguous I/O failure needs a fresh read before retry.

Reads scan the published batch group catalog and use Forest's positioned
CID/frame read with block verification. A process-local cache retains at most
64 previously verified group handles, keyed by their exact committed catalog
value. A changed catalog is re-opened and checked; a mismatch observed while
opening is refused. The snapshot and selected frame/block are checked; this is
not a fresh full scrub of unchanged, unread bytes on every access. A missing
block is omitted, but a missing or corrupt committed archive and a degraded
store are errors rather than evidence of absence. CID parsing rejects trailing
bytes. Lookup currently scales linearly in the number of batches; no GC,
compaction, distributed fencing or independent-node retention is implemented.

On 2026-11-14 JST, local Babashka 1.12.218 with the pinned real Forest tool
published 20 fixture blocks in two Packs, repeated the put without a root
change, rejected a CID mismatch, added a later batch and published a ref. A
fresh process recovered all 21 blocks and the ref; it refused a missing Pack
in an independently copied store. Two concurrent different batches were both
recoverable; changing a cached catalog to an invalid record was refused. The
storage/Pack/IPLD/ref/block unit suite passed 40 tests / 263 assertions. The
hosted Linux CI job contains real-tool, race, invalidation and missing-Pack
proofs; exact-head CI must be checked separately.

A separate local JVM reference query used the actual composed block/ref ports
to restore the persisted Prolly basis, apply Dango and the real reader policy,
and run the Datalog join. It returned the expected row and denied wrong basis,
expiry, invalid seal and supplied revocation. The query accessed one Pack;
the separate block proof reads both Packs. On this uncontrolled macOS arm64
host, one full JVM invocation including startup and all query controls took
19.45 s / max RSS 3,854,598,144 bytes before verified-handle caching, and
3.83 s / max RSS 1,250,918,400 bytes afterwards. The corpus, executable and
input were the same but cache state and other load were not controlled; these
are single observations, not a performance gate or production capacity
claim. The high memory use and linear catalog scan remain open work.

The block and ref operations are separate, as required by the Kotobase
contract: put must complete before ref publication, and the ref port does not
verify the target exists. A separately supplied authority must validate signed
basis; this adapter does not create signatures or bind receipts. This is a
hosted bounded prototype, not a GiB generic-block writer, Native execution,
OS-cache-loss qualification, device power-loss proof or production deployment.

## Composed ref target admission

The current `open-backend` adds a target check to the standalone ref port:
if the expected ref matches, it reads and verifies the proposed target CID
through the composed Forest block port while holding the same local writer
lock, before appending WAL or publishing root. Missing targets fail with
`:missing-ref-target`; a stale expected ref returns ordinary CAS refusal
without dereferencing the proposed target. The standalone `open-ref-store`
retains its original ref-only semantics. This supersedes the earlier sentence
that the **composed** backend does not verify the target; separate block and
ref publications remain unchanged.

On 2026-11-14 JST, local hosted unit tests passed 42 tests / 272 assertions.
They checked missing-target root invariance, stale-ref behavior and that the
target callback holds the writer lock. The actual pinned Forest tool then
published the two-Pack block fixture, rejected a missing target without a
root change, published the existing target, and a separate process recovered
21 blocks and the ref. Nix hosted CI includes the proof; its exact-head
result remains separate.

Only the named block is verified. This does not traverse the DAG or prove
that linked blocks exist, authorize or authenticate the commit, protect
against external file tampering after verification, provide safe GC, solve
CID-based ABA, or provide distributed fencing. Block creation and ref CAS are
still separate durable operations; an interrupted writer may leave unreferenced
immutable data. This is not a Native or production qualification.
