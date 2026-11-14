# Bounded hosted transaction overlay for Forest

`open-transaction` provides synchronous Prolly `:put!` and `:get-fn` ports
backed by a bounded, in-memory overlay. A put validates and owns its bytes
and CID but is **not a durable acknowledgement**. `:publish!` first writes
all staged blocks as one Forest batch, checks the block-store acknowledgement,
and only then performs the checked ref CAS. A stale ref may leave an immutable
orphan batch; a write or validation error closes and clears the overlay.
After publication, rejection or abort the overlay cannot be reused. Staged
reads return copies. A buffer is limited to 4,096 distinct blocks and 32 MiB,
with the existing 850 KiB per-block bound. No caller should expose a new
basis until `:publish!` reports success.

On 2026-11-14 JST the same hosted Prolly two-transaction fixture from
`README-kotobase-forest-transact.md` ran through the batched overlay and the
pinned real Forest tool. Both physical root CIDs matched the earlier
unbatched run exactly. A separate JVM reopened the current root and checked
that old and as-of queries returned `alpha` and current query returned `beta`.
In these single local observations, `du -sk` reported retained staging of
795,792 KiB in 12 directories for the unbatched path and 132,632 KiB in 2
directories for the batched path; the corresponding stores used 144 KiB and
40 KiB. Each retained batch still includes an approximately 65 MiB copy of
the pinned tool. These are APFS allocation observations on synthetic data,
not controlled performance or capacity results. Both runs remain on disk.
The successful Prolly write was run on the initial overlay prototype; the
later added terminal-on-error guard was validated with unit tests and an
actual tool proof, and the existing batched result was reread with final code.

The local hosted unit suite passed 46 tests / 296 assertions. It covered
read-your-writes, copy isolation, abort, stale CAS with retained orphan,
failed block flush without ref publication, invalid input and overflow
closing the overlay. A separate real-tool proof wrote three blocks in one
batch and recovered them in a fresh process; an untrusted tool caused a
failed flush, unchanged root and absent ref. Both are included in hosted CI;
exact-head results are separate. No local Nix was available.

Block-batch publication and ref CAS remain two durable operations, not a
single all-or-nothing transaction. The target check covers only the target
block, not its linked closure; the ref contract cannot detect A→B→A. No
signed basis, policy/receipt binding, safe garbage collection, distributed
fencing, Native I/O, OS cache loss or production qualification is claimed.

To reproduce the local Prolly observation, prepare the adapted Kotobase
classpath and pinned tool as described in `README-kotobase-forest-transact.md`,
set `KOTOBASE_TX_OUTPUT` to a new private path and run
`kotobase_forest_batched_transact.clj write` then `read` in separate processes.
The proof retains its staging and needs adequate free disk. The local JVM is
an Otehon reference, never a Native gate or runtime fallback.
