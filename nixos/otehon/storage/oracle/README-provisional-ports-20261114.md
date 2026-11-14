# Explicit provisional Forest ports, 2026-11-14

`publish-ports!` offers a trusted synchronous builder only explicit `:put!` and `:get-fn` functions. These ports are not an `IBlockStore`, and `put!` does not claim durable persistence. The API validates bounded blocks, persists the batch, invokes the required semantic verifier, performs ref CAS and returns the builder value only after successful publication. Failure/stale ref throws and may leave immutable orphans. Ports are unusable after exit. The trusted builder must not make external effects; concurrent GC and distributed fencing remain outside the operation. The older `publish-scoped!` remains for compatibility while callers migrate and still has its documented provisional-protocol caveat.

On macOS ARM Babashka 1.12.218 the transaction suite passed 9 tests / 69 assertions, including no durable protocol on ports, builder/verifier failures, stale CAS and closed ports. The actual pinned Forest tool wrote five blocks through the new ports; a fresh process with a nonexistent writer verified every byte/CID and found two physical Packs. CI is configured to repeat this hosted proof on Linux; exact-head CI pending. This is not a product query integration, Native, GC, independent-node, GiB or power-loss claim. ~68 MiB task staging including a private tool copy was retained.

Source SHA-256 `0e6c34b1c666e9a84733253fc7ab5f935569ecbec35597c81ccc760d9d61da25`, unit test `380a4b8985d7013e9e71aa278dfc1f22106c6eb2a7be05d0d48172cfa1cc47d8`, real-tool proof `c6489b549587afd9d28e97ba13f150ae0503b624952441431ff36dac5ad6227e`. Commands from repo root, output path must not exist:

```sh
cpth='nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/vendor/kotobase-storage/src:nixos/otehon/storage/test'
bb --classpath "$cpth" -e "(require '[clojure.test :as t] 'otehon.kotobase-forest-transaction-test)(let [r (t/run-tests 'otehon.kotobase-forest-transaction-test)] (System/exit (+ (:fail r) (:error r))))"
bb --classpath "$cpth" nixos/otehon/storage/test/otehon/kotobase_forest_transaction_proof.clj ports-write .agent-output/ports-publication-proof-01 .agent-output/gib-actual-writer-01/stage/forest-tool
bb --classpath "$cpth" nixos/otehon/storage/test/otehon/kotobase_forest_transaction_proof.clj scoped-read .agent-output/ports-publication-proof-01 /nonexistent/forest-tool
```
