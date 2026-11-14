# Conditional large-file Forest publication, 2026-11-14

The hosted file-backed importer accepts an optional `:expected-generation`. Its comparison runs under the existing local OS writer lock before the immutable-Forest publication hook and root publication. `put-file-large!` forwards an explicit option and rejects invalid generations before staging. Existing callers without an option retain unconditional behavior; they are not protected from stale replacement. This is local optimistic concurrency, not cross-node fencing or consensus.

On macOS arm64, Babashka 1.12.218 and the pinned Forest tool SHA-256 `e5fb23076a46c055142b3dbf3efa1ad5a68532d14419ad9994785986719b205f` ran `forest_large_cas_proof.clj` against two distinct 17 MiB, two-Pack synthetic files. The first conditional publish succeeded; after a separate metadata transaction advanced the root, a writer using the stale generation was refused and the committed root, store object names and full old-file SHA-256 remained unchanged. A retry with the current generation succeeded, and a fresh process read the new file and matched its full source SHA-256 and two-Pack count. Invalid nil generation was rejected before creating a staging directory. Existing hosted storage, pack and writer tests passed 27 tests / 164 assertions.

Reproduce with a pinned Forest tool and a new private output under a task worktree:

```sh
bb --classpath 'nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/test' nixos/otehon/storage/test/otehon/forest_large_cas_proof.clj write <new-output> <forest-tool>
bb --classpath 'nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/test' nixos/otehon/storage/test/otehon/forest_large_cas_proof.clj read <same-output> <forest-tool>
```

The Otehon Linux hosted workflow invokes both phases; exact-head CI is separate. Staging and rejected candidates are retained. The test does not establish concurrent adversarial source mutation safety, product callers choosing conditional generation, a 1 GiB write, Native I/O, OS cache loss, real power loss, or distributed fencing.

## Conditional CLI entry

The hosted `forest-file-put-large STORE NAME INPUT STAGE TOOL` CLI now reads the committed generation before staging and uses conditional publication. It refuses a degraded read. Callers may instead supply a seventh argument, a canonical positive decimal expected generation no larger than 9,007,199,254,740,991; malformed values are refused before staging. Unrelated writes between observation and publication can cause a conservative stale refusal. The lower-level legacy writer arity remains unconditional.

On 2026-11-14, `forest_large_cli_cas_proof.clj` ran the real CLI function against the prior two 17 MiB source files and the pinned Forest tool. An injected other-writer commit after the CLI's implicit generation read caused a stale refusal with the old full hash intact. An explicit stale generation was also refused; an explicit current generation published two Packs. A separate Babashka process recovered and matched the new file's full SHA-256. Zero, leading-zero, negative, overflow and non-numeric generations were refused before staging; a unit test separately refused a degraded store before invoking the writer. `forest-writer-test` passed 3 tests / 15 assertions. The hosted Linux workflow now runs both phases following the earlier CAS proof. Local process restart is not OS cache loss or power-loss proof, and direct legacy library calls are not protected.

## Conditional logical import CLI

The existing hosted `logical-forest-import` CLI now observes the committed generation before reading the manifest and passes it to the conditional multi-Pack importer. A degraded store is rejected before the input manifest is opened. Library callers that omit `:expected-generation` remain unconditional. Any intervening local transaction, including an unrelated one, can conservatively reject the import.

On 2026-11-14, the existing `cli_logical_proof.clj` ran the real CLI with four preserved Forest Pack fixtures in separate processes. It still accepted a valid import and cross-Pack range, and rejected a bad manifest CID, a symlinked Pack and an output overwrite. A test hook advanced the store immediately after the CLI captured its generation: the importer refused the stale candidate, the resulting root/state equaled the state after the competing write, and the original cross-Pack range remained correct. A unit test checked that degraded state is rejected before the importer is called. Hosted Babashka `forest-writer-test` passed 4 tests / 17 assertions. The existing Otehon hosted check includes `cli_logical_proof.clj`; exact-head CI is separate. This does not establish OS cache loss, a Native writer or distributed fencing.
