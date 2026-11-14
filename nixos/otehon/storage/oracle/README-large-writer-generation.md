# Conditional large-file Forest publication, 2026-11-14

The hosted file-backed importer accepts an optional `:expected-generation`. Its comparison runs under the existing local OS writer lock before the immutable-Forest publication hook and root publication. `put-file-large!` forwards an explicit option and rejects invalid generations before staging. Existing callers without an option retain unconditional behavior; they are not protected from stale replacement. This is local optimistic concurrency, not cross-node fencing or consensus.

On macOS arm64, Babashka 1.12.218 and the pinned Forest tool SHA-256 `e5fb23076a46c055142b3dbf3efa1ad5a68532d14419ad9994785986719b205f` ran `forest_large_cas_proof.clj` against two distinct 17 MiB, two-Pack synthetic files. The first conditional publish succeeded; after a separate metadata transaction advanced the root, a writer using the stale generation was refused and the committed root, store object names and full old-file SHA-256 remained unchanged. A retry with the current generation succeeded, and a fresh process read the new file and matched its full source SHA-256 and two-Pack count. Invalid nil generation was rejected before creating a staging directory. Existing hosted storage, pack and writer tests passed 27 tests / 164 assertions.

Reproduce with a pinned Forest tool and a new private output under a task worktree:

```sh
bb --classpath 'nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/test' nixos/otehon/storage/test/otehon/forest_large_cas_proof.clj write <new-output> <forest-tool>
bb --classpath 'nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/test' nixos/otehon/storage/test/otehon/forest_large_cas_proof.clj read <same-output> <forest-tool>
```

The Otehon Linux hosted workflow invokes both phases; exact-head CI is separate. Staging and rejected candidates are retained. The test does not establish concurrent adversarial source mutation safety, product callers choosing conditional generation, a 1 GiB write, Native I/O, OS cache loss, real power loss, or distributed fencing.
