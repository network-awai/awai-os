# Hosted governed query and Forest receipt oracle — 2026-11-13 UTC

This local reference experiment composes the existing Kotobase governed
execution at cloud-itonami/app-itonami-kotobase PR #101 head
`759d4111c1579a1ecb18890516a67f90e3057adb` with the bounded Otehon Forest
writer. It reads a real Prolly snapshot and Datalog join from the two-archive
fixture documented in `README-prolly-forest-writer.md`; a Dango capability
and the snapshot's reader policy feed a test-only authorization adapter. The
query ID identifies one hard-coded join, rather than a general query compiler.

Deterministic test Ed25519 keys sign an ExecutionManifest binding the Prolly
basis and policy and an ExecutionReceipt binding manifest, request and result.
The sink writes canonical receipt, request and manifest blocks to a Forest
archive, publishes the Otehon WAL/root, and verifies the bytes on readback
before acknowledging. A fresh JVM process recovers the group, checks all CIDs,
verifies both signatures, and checks the manifest/request and result bindings.
The observed allow receipt CID is
`bafyreiede6zwkhqyrb7omenbablh33gxqrddwxzljj65jcjxtgcnxghydu`.
An injected sink failure withheld rows after evaluation. A denied admission did
not evaluate and persisted a deny receipt with no result root. Denial was
injected at the test authorization adapter, not a revocation distribution test.

The `:cost` fields are required synthetic zero placeholders in this fixture;
they are **not measurements**. Time, nonce ledger, keys, schema, grant, plan,
identity encryption and synthetic blinding are test inputs. The readback tests
process restart only; it does not establish OS-cache loss, power-loss
persistence, independent nodes, production key custody, a signed data commit,
Native execution or a deployed receipt sink. The result is not a performance
comparison. The receipt implementation here is an experimental host adapter,
not Kotobase's causal-commit sink.

The oracle requires the existing `.agent-output/ipld-writer-v3/store` fixture,
the adapted Kotobase reference classpath from PR #101, and the pinned Forest
tool from the writer proof. `FOREST_TOOL` selects that tool; the writer checks
its digest. The scripts create `.agent-output/receipt/store` and `stage` and
refuse pre-existing output paths. Preserve or choose a clean task worktree for
a rerun. The JVM is a local oracle, not a Native execution path or CI gate.
