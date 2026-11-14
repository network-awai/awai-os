# Explicit-port Forest two-Pack process-death proof, 2026-11-14

The previous scoped writer SIGKILL proof used the compatibility `publish-scoped!` protocol overlay. `scoped_forest_crash_proof.clj` now also has `run-ports`, which uses the actual `publish-ports!` API and explicit provisional put/get functions. The original scoped mode remains in CI.

On macOS ARM with Babashka 1.12.218 and the pinned Forest tool SHA-256 `e5fb23076a46c055142b3dbf3efa1ad5a68532d14419ad9994785986719b205f`, the full two-case explicit-port run passed. After the second Pack was half-written and the child was SIGKILLed, a fresh process recovered the distinct old ref/bytes; retry published the complete new state. After the new ref's root rename and SIGKILL, a fresh process recovered the new ref and all 20 blocks from exactly two physical Packs; retry against the old ref was refused as stale. Each final new state was read in a fresh process and compared byte-for-byte/CID against the fixture.

```clojure
{:event :half-written, :role :forest, :occurrence 2, :recovered "old", :retry :verified, :pass true}
{:event :renamed, :role :root, :occurrence 2, :recovered "new", :retry :verified, :pass true}
{:cases 2, :two-pack true, :api "run-ports", :sigkill true, :pass true}
```

This is one cooperative local writer and process death, not guest OS cache loss, physical power failure, hostile fencing, concurrent GC, Native, product query or GiB qualification. The retained task output is ~271 MiB, mostly pinned tool staging copies. No files were deleted. Linux hosted Otehon CI is configured to run both compatibility and explicit-port modes; exact-head CI is pending. Proof source SHA-256 `8ff0ae125b60523b97a13acfa2cf259bff6c35e68ec2043139f06c42b39cce12`. The earlier scoped mode was not rerun locally after generalizing the script; CI covers it.

```sh
FOREST_TOOL="$PWD/.agent-output/gib-actual-writer-01/stage/forest-tool" bb --classpath 'nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/vendor/kotobase-storage/src:nixos/otehon/storage/test' nixos/otehon/storage/test/otehon/scoped_forest_crash_proof.clj run-ports .agent-output/ports-crash-proof-01
```
