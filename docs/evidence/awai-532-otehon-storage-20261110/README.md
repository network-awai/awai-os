# AWAI-532 Otehon adapter — 2026-11-10

The reviewed apex PR #179 was squash-merged as
`68e820bc9c1c3beac4cadc3a18a5030d25db0b61`. Its pure WAL module is pinned
byte-for-byte in the Otehon adapter dependency; the package checks its digest.
This change adds the actual hosted-file adapter and an opt-in Otehon CLI,
including immutable object hashes, A/B root slots, file/directory sync and a
process-held writer lock.

| Check | Result |
| --- | --- |
| macOS / Babashka 1.12.218 unit tests | 9 tests / 32 assertions, 0 failures/errors |
| Nix-pinned aarch64 Linux / Babashka 1.12.218 unit tests | 9 tests / 32 assertions, 0 failures/errors |
| macOS interrupted write/checkpoint cases | 25/25 |
| Nix Linux interrupted write/checkpoint cases | 25/25 |
| Nix-built CLI init/put/checkpoint/read | expected state recovered |
| NixOS module option evaluation | disabled excludes CLI; enabled includes CLI; no daemon |
| Mutated upstream module digest | package evaluation refused, exit 1 |

Every process case checks a denied concurrent writer, force-kill exit 137,
fresh-process recovery and successful mutation after the lock-owning writer
dies. The partial-write cases stop after half the record bytes are written,
before file sync or rename. Before root rename the prior root is selected;
after root rename the new root is selected for this process-death model.
Checkpoint publication is checked independently of ordinary mutation.

Unit coverage includes read/checkpoint/delete roundtrips, unicode, corrupted
snapshot/WAL hashes, missing committed data, degraded root fallback with
mutation refusal, initialization/operation/size refusals, symlink refusal,
actual publication order, overlapping writers, error cleanup and completing
directory sync when retrying a renamed orphan.

`measurement.json` records versions, exact check commands, container/Nixpkgs
pins, upstream identity, source digests and scope limits. Adjacent files are raw
outputs. Full synthetic scratch stores, including partial records and original
development attempts, remain in the task worktree's `.agent-output/`.

No existing service or user volume was changed. This is a package build and
hosted Linux container test, plus NixOS option evaluation; no NixOS VM boot or
installed-system cutover was performed. OS cache survives process death. Device
power loss, cache-cold recovery, hostile rollback, key custody/AEAD, Pack/CAR
payloads, real media performance, independent peers and native qualification
remain open under AWAI-532 and the related storage issues.
