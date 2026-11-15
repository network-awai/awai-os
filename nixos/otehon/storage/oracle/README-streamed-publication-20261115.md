# Bounded streamed Forest publication, 2026-11-15

`publish-streamed-ports!` allows a trusted synchronous builder to put more than one bounded batch before a single ref CAS. Callers must set total byte and put-count limits. Each batch is immutable and visible by CID as soon as it is flushed, so all put acknowledgements remain provisional and failed or stale publication may leave orphan data. The ports close before final persistence/semantic verification, the published target must exist, and the host-supplied verifier must approve the complete persisted closure before CAS. Concurrent GC, writer exclusivity/fencing, cross-ref atomicity, idempotent retry and ambiguous CAS outcomes are not supplied. `streamed-receipt-publication-adapter` exposes the same staged path to a host receipt builder and verifier; it does not itself define the receipt graph or trust policy.

On macOS ARM, Babashka 1.12.218 ran `kotobase-forest-transaction-test`: 15 tests / 108 assertions, zero failures. Tests include 34,426,880 logical bytes across two buffer flushes, a single ref CAS, refusal of missing target, bounds, stale ref and verifier failure, closure of ports before verification, and builder failure after one flush leaving unreferenced immutable data. The pinned Forest 0.39.0 tool SHA-256 `e5fb23076a46c055142b3dbf3efa1ad5a68532d14419ad9994785986719b205f` wrote 41 mostly-zero 820 KiB blocks through the streamed receipt adapter; a separate Babashka process with a nonexistent writer tool read all 41 bytes/CIDs and found two batches. The writer and reader were separate processes. A separate copied store from an earlier streamed run rejected a withheld archive with `:missing-forest`; its original remains intact. The task-owned stores and stages are retained.

`reboot-check.nix` now includes a streamed write and read before guest shutdown, read after a changed boot ID, and a missing-archive negative control. This NixOS VM check was not run locally because Nix was unavailable; exact-head CI remains required. The local proof is about 32.8 MiB of mostly-zero synthetic data, not a GiB test, full Kotobase Datalog integration, physical power loss, Native execution, host cache loss, independent-node durability, or production qualification.

Commands, from the repository root, using a new task-owned output directory:

```sh
cpth='nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/vendor/kotobase-storage/src:nixos/otehon/storage/test'
bb --classpath "$cpth" -e "(require '[clojure.test :as t] 'otehon.kotobase-forest-transaction-test)(let [r (t/run-tests 'otehon.kotobase-forest-transaction-test)] (System/exit (+ (:fail r) (:error r))))"
bb --classpath "$cpth" nixos/otehon/storage/test/otehon/kotobase_forest_transaction_proof.clj stream-write .agent-output/stream-publication-04 .agent-output/gib-actual-writer-01/stage/forest-tool
bb --classpath "$cpth" nixos/otehon/storage/test/otehon/kotobase_forest_transaction_proof.clj stream-read .agent-output/stream-publication-04 /nonexistent/forest-tool
```
