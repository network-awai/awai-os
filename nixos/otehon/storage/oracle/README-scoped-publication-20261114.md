# Scoped Kotobase batch publication, 2026-11-14

`otehon.kotobase-forest-blocks/publish-scoped!` exposes a bounded synchronous builder scope over the existing Forest transaction. The builder receives an internal volatile protocol adapter, with provisional block acknowledgements only; its ref CAS is forbidden. The host is trusted not to release provisional results or cause external side effects. A mandatory semantic verifier checks persisted blocks before ref CAS; builder failure, verifier refusal, malformed result and stale ref throw rather than returning the builder value. The adapter is closed after exit. It is not safe to use the scoped backend as a durable public `IBlockStore`; no transaction with concurrent GC, external side effects, independent-node fencing or production authority is claimed.

On macOS ARM Babashka 1.12.218, `kotobase-forest-transaction-test` passed 7 tests / 53 assertions. With the pinned Forest tool SHA-256 `e5fb23076a46c055142b3dbf3efa1ad5a68532d14419ad9994785986719b205f`, a separate writer process submitted five blocks, including two deterministic random 600 KiB blocks, through the new API in one group; a fresh process with no writer executable verified all bytes/CIDs and observed two physical Packs. A copied store with a modified Forest header was rejected as `:corrupt-forest`; the original fixture remains intact. The test output occupies ~68 MiB including its retained tool copy. CI is configured to run the two-process proof with its pinned Linux Forest tool; exact-head CI is pending. This is hosted Otehon, not Native, real-device power-loss, GiB, GC, or signed query/receipt product integration.

Source SHA-256 `5bfa4b1073466678b87ccb5bd766aa42e921be61c4f5cfe3fbc568f25bda8216`; unit test `34721ca440df02b903abb2880f552713d4fb1a81d63f18c2c920921efa7d1012`; actual-tool proof `a6d05fbd5efefe233840592825d3be9f0161dd606a17bae1207fdbb72ed54369`.

```sh
cpth='nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/vendor/kotobase-storage/src:nixos/otehon/storage/test'
bb --classpath "$cpth" -e "(require '[clojure.test :as t] 'otehon.kotobase-forest-transaction-test)(let [r (t/run-tests 'otehon.kotobase-forest-transaction-test)] (System/exit (+ (:fail r) (:error r))))"
bb --classpath "$cpth" nixos/otehon/storage/test/otehon/kotobase_forest_transaction_proof.clj scoped-write .agent-output/scoped-publication-proof-01 .agent-output/gib-actual-writer-01/stage/forest-tool
bb --classpath "$cpth" nixos/otehon/storage/test/otehon/kotobase_forest_transaction_proof.clj scoped-read .agent-output/scoped-publication-proof-01 /nonexistent/forest-tool
```
