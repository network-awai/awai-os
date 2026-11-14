# Valid stale root counterexample (2026-11-14 UTC)

At source revision `a27f52d`, this hosted local counterexample initializes a fresh store and saves generation 1 slot 1, publishes an `old` file at generation 2, then publishes `new` at generation 3. In the isolated test store it replaces slot 1's generation 3 bytes with the previously saved, valid generation 1 bytes. The two root-slot byte hashes then exactly equal the pair observed after generation 2. Current recovery chooses generation 2, reports `:degraded? false`, and returns `old`; this is an **undetected rollback**, not a passing recovery test.

Simply checking whether the two root generations are consecutive does not solve this example: the restored pair is generations 1 and 2. Generation 3's immutable objects remain present, but unreferenced objects can also result from interrupted writes and do not independently prove publication. Detecting this class of rollback requires a separately trusted monotonic witness or equivalent trusted state and an explicit commit/recovery protocol; a local witness that can itself be rolled back is not an anti-rollback anchor. Restoring both slots, restoring an initial sentinel, and reverting an entire volume remain outside the local two-slot guarantee.

On macOS arm64 with Babashka 1.12.218, command from the Otehon worktree:

```sh
STALE_ROOT_OUTPUT="$PWD/.agent-output/stale-root-counterexample-02" bb --classpath nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/vendor/kotobase-storage/src:nixos/otehon/storage/test nixos/otehon/storage/oracle/stale_root_counterexample.clj
```

Output: `{:root-pair :identical-to-previous, :new-generation 3, :observed-generation 2, :degraded? false, :returned "old", :rollback :undetected, :counterexample true}`. Source SHA-256 `3142408eaae1aedefe249b8437df17afc5968ed753b2ae4128fa052ea3a9974c`. This script demonstrates the limitation and is intentionally not installed as a passing qualification gate. It retains its new isolated output and both saved generations. The first attempt failed before creating a store because `dir` conflicted with a Babashka namespace name; the successful run uses `store-dir` and a fresh output. This says nothing about Native, OS-cache loss, or production key custody.
