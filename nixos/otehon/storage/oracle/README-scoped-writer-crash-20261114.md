# Scoped Forest two-Pack process-death proof, 2026-11-14

On macOS ARM, Babashka 1.12.218 and the pinned Forest tool SHA-256 `e5fb23076a46c055142b3dbf3efa1ad5a68532d14419ad9994785986719b205f` ran the actual `publish-scoped!` product adapter. An old distinct CID/ref was seeded, then a separate child attempted to publish 20 blocks, including two deterministic incompressible 600 KiB blocks, into a new group. At each instrumented boundary the parent waited for an explicit readiness message and SIGKILLed the child, copied the store records and verified a fresh process:

- During the second Forest file write, the old ref and bytes recovered; retry published the complete new group.
- Immediately after the second root rename (the ref publication, following the catalog root), the new ref and all 20 blocks recovered; retry with the old expected ref was refused as stale.

After adding an explicit check that the new group actually contains two physical Packs, fresh processes re-read both final stores and confirmed all 20 block bytes/CIDs and two Packs; the copied pre-retry old store also verified. The full two-case run was performed before those additional readback assertions and the explicit old/new-distinct check were added. Original output, copied stores and staging (~271 MiB) were retained under `.agent-output/scoped-crash-proof-01`. The writer and verifier have a single local cooperative store; a SIGKILL is not OS cache loss, a physical power cut, independent fencing, Native execution or proof of snapshot/GC concurrency. Linux Otehon CI is configured to run the proof; exact-head result is pending. No throughput claim.

Proof source SHA-256 `d4aff3f2bdf012ba0f6cfe6f9f454ec57951f2ff520645be4da9d91b3a49dc9d`. Run from repository root, with an unused output path:

```sh
FOREST_TOOL="$PWD/.agent-output/gib-actual-writer-01/stage/forest-tool" bb --classpath 'nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src:nixos/otehon/storage/vendor/kotobase-storage/src:nixos/otehon/storage/test' nixos/otehon/storage/test/otehon/scoped_forest_crash_proof.clj run .agent-output/scoped-crash-proof-01
```
