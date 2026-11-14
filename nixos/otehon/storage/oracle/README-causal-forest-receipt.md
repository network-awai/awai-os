# Kotobase causal receipt sink over Forest — 2026-11-13 UTC

A hosted reference composition exercises the existing
`kotobase.causal-commit/execution-receipt-sink`, not a substitute receipt
format. The governed Datalog fixture described in
`README-governed-forest-receipt.md` runs its actual sink against a temporary
block overlay. The sink creates a Kotobase immutable commit and reads the
receipt back at that exact commit. The outer test adapter then publishes the
collected CID blocks as one Forest group, drops the overlay, recovers the
Forest group, and repeats the exact-commit receipt read. Only then does it
return the sink's acknowledgement and allow the query to return rows.

A new JVM process recovered the group, read the commit and receipt through
Kotobase, checked the canonical receipt CID, verified the executor Ed25519
signature and checked receipt/request/manifest bindings. It observed commit
`bafyreigqlrbdbfhf26eipy3xfgpyfqncjjeontzgigd3ywz5wx7axlbyea` and receipt
`bafyreiede6zwkhqyrb7omenbablh33gxqrddwxzljj65jcjxtgcnxghydu`.
An injected Forest publication failure prevented a receipt acknowledgement
and returned no rows; a subsequent clean run succeeded.

The adapted local classpath uses app-itonami-kotobase PR #101 head
`759d4111c1579a1ecb18890516a67f90e3057adb`, kotobase-engine
`b8b163e889341cdf49217570380872e0575fcbdd`, kotobase-peer
`e98d086469d284643e6a6469f2451f9703d443fe`, and Kotoba library revision
`b94158fd48ec541b70d3c455912a06f407537ddc`. Other adapted fixture sources and
the pinned Forest binary are as recorded in the prior oracle evidence. The
JVM version was Clojure CLI 1.12.5.1654. No new dependencies were downloaded.
The test classpath converts `.cljk` names to `.cljc` for this local oracle;
it is not a Native runtime path.

The overlay and its local single-writer refs are fixtures, as are authority,
key custody, nonce, schema, plan, encryption and cost. The Kotobase sink's
initial readback is from the overlay, not from stable media; the enclosing
adapter is responsible for Forest publication and the second readback. The
fixture uses one commit and does not provide a production provider, persistent
ref, multi-process fencing, a signed data commit, large or multiple archives,
OS cache eviction, or power-loss evidence. A process restart is not an OS
restart. Cost fields are synthetic placeholders, not measurements.

To rerun after preparing the adapted classpaths and the prior data fixture,
set `FOREST_TOOL` to the digest-pinned tool and `CAUSAL_RECEIPT_OUTPUT` to a
new empty scratch directory, then invoke `causal_forest_receipt.clj` and, in a
new process, `causal_forest_receipt_read.clj` with the same classpath used for
`governed_forest_receipt.clj` plus the adapted engine, peer and causal sources
first. The test retains its staging and output for inspection.
