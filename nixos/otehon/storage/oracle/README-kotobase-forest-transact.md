# Prolly transactions through the hosted Forest backend

On 2026-11-14 JST a local Clojure CLI 1.12.5.1654 reference run used the
pinned Kotobase Prolly engine with the actual Otehon Forest `IBlockStore` and
checked `IRefStore`. The first transaction added `file/name = alpha`, and
its physical root was published by ref CAS. The second retracted `alpha`,
added `beta`, and advanced the ref. A stale CAS was refused. A separate JVM
reopened the store, read the ref, restored both roots and ran Datalog: the old
root and the new root at `:as-of 1` both returned `alpha`, while the latest
snapshot returned `beta`. In a separately copied store, withholding the Pack
containing the published new root caused `committed Forest archive is
missing`, not a silent fallback. The original store and withheld file remain.

The roots were
`bafyreia6sewmc3tpbmlnur4e4e5himj5yg4eya6e4igotbmtifvwweibmi` and
`bafyreiczbylfrpsshqklrxp6jjc55k2jrkrvpakcdvm4eqjjrpoecuwgua`.
They are physical Prolly roots; no signature, policy or receipt was added by
this transaction proof. The fixture uses identity encryption, synthetic blind
keys, a fixed query and local single-host CAS. The old root is also recorded
in a sidecar for the explicit old-root check; `:as-of 1` is recovered through
the current Prolly state. The run does not qualify Native, guest/host OS cache
loss, device power loss, distributed fencing or production.

The storage cost is a material limitation. This tiny two-transaction run
created 12 retained staging directories; `du -sk` reported 795,792 KiB for
staging versus 144 KiB for the store. Each block put currently creates its
own batch and copies the approximately 65 MiB pinned Forest tool into its
private staging directory. This is observed disk allocation, not a general
capacity benchmark. The files were retained as evidence, and the host had
approximately 2.3 GiB free afterwards. A bounded transactional batching or
safe shared-tool design needs separate implementation and verification; do
not use this result to justify routine production use.

To reproduce, set `KOTOBASE_TX_OUTPUT` to a new private scratch path and
`FOREST_TOOL` to the pinned tool, prepare the adapted local Prolly oracle
classpath as in `README-prolly-forest-writer.md`, and run
`kotobase_forest_transact.clj write` and then `read` in different JVM
processes. Check available disk first; outputs and staging are intentionally
retained. The JVM is an Otehon reference oracle, not a Native execution path
or fallback. No new dependency downloads were needed.
