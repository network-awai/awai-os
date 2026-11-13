# Signed snapshot and causal receipt: hosted reference

On 2026-11-14 JST, this local oracle composed the signed two-Pack Prolly
snapshot from `README-signed-basis-multipack.md` with the Kotobase governed
execution and actual `causal-commit/execution-receipt-sink` used in
`README-causal-forest-receipt.md`. It checked the signed logical checkpoint,
policy CID and frontier admission first; an altered signed checkpoint was
rejected before the query callback. The governed read then used the verified
physical snapshot and policy, a Dango fixture decision and the real Datalog
join. The sink created a signed ExecutionReceipt and Kotobase commit; the
outer fixture adapter published its blocks, the canonical request and the
signed ExecutionManifest into a Forest group and checked receipt readback
before returning rows. An injected Forest publication failure withheld rows.

A fresh JVM recovered the separate data and receipt groups and verified the
signed checkpoint, receipt and ExecutionManifest signatures, canonical CIDs,
request/receipt/manifest bindings and matching physical basis and policy.
The proof CID was `bafkreigfbzgc3xh4uel37eg7msupniof57qzp2kpo3vepw55a`,
the ExecutionManifest CID was
`bafyreiey5bufpws527ya47e75vjgezvxn4jmvtm47xbefwicpiuuteegmy`, and the
receipt CID was `bafyreiede6zwkhqyrb7omenbablh33gxqrddwxzljj65jcjxtgcnxghydu`.

This is composition evidence, not an integrated product admission API. The
ExecutionManifest's `:location/manifest` remains a fixture; no field in this
experiment cryptographically names the signed proof. The proof and receipt
are in separately published groups. A verifier needs the correct proof as a
separate trusted input; matching physical basis and policy does not replace a
signed binding of the proof CID. The adapter uses in-memory staged blocks and
refs, test keys and synthetic authority, nonce, time, schema, transaction
history and cost. It is not multiwriter fencing, secure persistent frontier,
product key custody, Native execution, OS-cache-loss or power-loss evidence.

The local JVM oracle used Clojure CLI 1.12.5.1654, Kotobase PR #101 head
`759d4111c1579a1ecb18890516a67f90e3057adb`, and the adapted sources and
pinned tool described in the two references above. The Kotobase `.cljk`
sources were copied to an oracle-only classpath with `.cljc` extensions;
they are not a production dependency or CI fallback. No dependency download
was needed. Prepare the signed group, adapted classpaths and receipt scratch
as in those references; set `SIGNED_BASIS_OUTPUT`, `GROUP_FOREST_STORE`,
`FOREST_TOOL` and a new empty `CAUSAL_RECEIPT_OUTPUT`, then execute
`signed_basis_receipt_write.clj` and `signed_basis_receipt_read.clj` in
separate processes. Scripts retain their output. Their composition checks
fixed source boundaries; they do not establish general-purpose provider APIs.
