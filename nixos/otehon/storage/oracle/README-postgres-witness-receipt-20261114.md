# Hosted witnessed causal receipt reference, 2026-11-14

This is a bounded local JVM reference, not Native or production admission. It joins the policy fixture and real Dango verification, hosted Kotobase Prolly/Datalog and governed execution, the real causal receipt sink, and the witnessed Forest block/ref adapter. The fixture issuer signs an execution manifest binding the policy and data basis; the fixture executor signs each receipt. The data basis itself is not a signed commit.

The causal sink writes to a bounded in-memory `open-transaction` overlay and reads it back there. Its provisional acknowledgement is **not** returned to the executor until the overlay is published as witnessed Forest blocks and a witnessed ref, and a fresh database object reads back the exact receipt from the published commit. Block batch and ref publication are separate witness transitions; failure may leave orphan immutable blocks and this does not implement an atomic multiple-Pack writer. The trusted bounded IPLD closure callback and local PostgreSQL witness are test-provided and do not prove an independent anti-rollback domain. A successful readback demonstrates availability of this specific receipt, not completeness for arbitrary application references or a signed data basis.

Run from the repository root with locally provisioned, pinned classpaths and the pinned real Forest tool:

```
sh nixos/otehon/storage/oracle/postgres_witness_prolly_check.sh NEW_ABSOLUTE_BASE NEW_SHORT_SOCKET ABSOLUTE_FOREST_TOOL receipt
```

The shell verifies the policy fixture, bounded-codec overrides, the 200-file Prolly classpath, the 131 extra receipt classpath files, and Forest tool against recorded SHA-256 manifests before starting a fresh private PostgreSQL cluster. Receipt adaptations include the exact Kotobase source at revision `759d4111c1579a1ecb18890516a67f90e3057adb`; the additional source hashes pin the local adapted artifact, not a claim that every dependency is an unmodified owner source. Policy classpath precedes receipt-sink classpath; their overlapping policy file differs and the pinned policy classpath wins.

On `.agent-output/pg21`, with PostgreSQL 14.19, Clojure CLI 1.12.5.1654 and OpenJDK 21.0.1 on macOS arm64: valid Dango authorizes one Datalog row; an injected refusal evaluates zero rows and publishes a signed deny receipt; an injected Forest publish failure returns no rows and publishes no receipt ref. After a clean database restart and a fresh JVM, allow and deny receipts are read through the witnessed adapter and their executor signatures verify. The allow commit is `bafyreigqlrbdbfhf26eipy3xfgpyfqncjjeontzgigd3ywz5wx7axlbyea`; deny commit is `bafyreiey6qckxtpi3e3zdplwfolccifb7s36q7on7kz6pecx3yy2r7crey`.

Test signing keys, fixed time, always-accept nonce callback, identity encryption and fixture policy are not production security. The deny is explicitly injected at authorization; it is not a demonstration of distributed revocation. Request and manifest are bound by CID in the receipt but are not independently persisted by this fixture. It does not establish remote B2 durability, machine/OS cache loss, power failure, Native Forest I/O or a deployed path. Output and PostgreSQL files are retained under the specified fresh base.
