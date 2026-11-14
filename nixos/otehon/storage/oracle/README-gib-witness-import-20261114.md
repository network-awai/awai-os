# Witnessed 1 GiB / 64-Pack hosted import (2026-11-14 UTC)

On macOS 26.4 arm64, Babashka 1.12.218, source revision `f876229`, `gib_witness_import.clj` imported the same preserved synthetic input's 64 distinct file-backed Forest Packs and canonical manifest into fresh control and witnessed stores. The witness was an in-process atom; its final root was saved for a separate reader process. The extra verifier in the witnessed import reopens and validates the published Pack catalog before witness CAS. This is a test double, not independently durable or multi-writer-safe witness storage.

One sequential run, control first, with host and cache uncontrolled: control import 63.405 s; witnessed import 93.997 s. These times cover import only and are exploratory, not a measured general overhead, hardware throughput, or performance gate. Input is sparse and highly compressible. A fresh process recovered the witnessed store, verified the manifest and all 64 Packs and read all 1,073,741,824 logical bytes. Their SHA-256 matched the original sparse source: `1f7e0c0d3fefe5579e556a04f7796b7de01278916e49a6d31df864e16adf1708`. Recovery and full logical read took 55.980 s; source hashing is outside this interval. The host's OS cache was not cleared; this does not establish physical read speed, OS restart, power loss, Native behavior, an independently trusted witness, or production qualification.

Reproduce with a preserved source created by `gib_actual_writer.clj` and a new output directory. The source fixture and output must be task-owned, and the output directory must not already exist. Set the environment and classpath shown below; run `write` and then `read` as separate processes. Output and intermediate stores are retained.

```sh
export GIB_SOURCE=.agent-output/gib-actual-writer-01
export GIB_WITNESS_OUTPUT=.agent-output/gib-witness-import-NEW
classpath=nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/vendor/kotobase-storage/src:nixos/otehon/storage/test
bb --classpath "$classpath" nixos/otehon/storage/oracle/gib_witness_import.clj write
bb --classpath "$classpath" nixos/otehon/storage/oracle/gib_witness_import.clj read
```
