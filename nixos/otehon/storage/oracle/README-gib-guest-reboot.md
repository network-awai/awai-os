# GiB file-backed Forest guest restart test

The existing NixOS guest test now installs a preserved, host-produced
file-backed 64-Pack group into the guest disk, verifies the full logical 1 GiB
before and after shutting down and restarting the guest OS, and checks that its
boot ID changes. A new process reads all 1,024 one-MiB ranges and verifies the
full SHA-256
`dd4ec50fea8f5a68daf225da4945af367e25bb870a09346060fa9dc088c001b0`.
After successful restart readback the test moves one guest-owned archive aside
and requires `:missing-forest` on recovery. The Nix test has 900 seconds per
GiB read, within the enclosing 45-minute CI job limit.

The fixture is copied from the previously documented AWAI-532 local hosted
GiB proof, whose synthetic sparse input and process-only measurements are in
`README-forest-gib-readback.md`. It contains 64 distinct actual Forest files
and immutable root, snapshot and WAL records; the checked-in bytes total
340,983 bytes. Every `.forest` file's filename matches its SHA-256. This is
highly compressible logical content, not 1 GiB of physical disk traffic. It
contains no user files. The input was created and the group published before
the VM; the guest copies it to its disk rather than exercising the writer.

On macOS arm64 with Babashka 1.12.218, the same `read-gib` probe recovered
all 64 Packs and matched the complete hash; an independent copied store with
a Pack moved aside failed with `:missing-forest`. The pre-existing local v2
four-Pack create/read regression also passed. The full NixOS VM test has not
been run locally because Nix is unavailable here: its exact-head CI result
must be checked separately. If it passes, it establishes a guest OS restart
and loss of that guest's page cache for this prebuilt group. It does not prove
host OS cache loss, the writer's guest durability, device power loss, Native
execution, signed Datalog query, independent nodes or production status.

## Exact-head CI observation

GitHub Actions [run 43518512335](https://github.com/network-awai/awai-os/actions/runs/43518512335)
passed the NixOS `guest-reboot` job for commit
`560263a23a6ee48a7e82118ff762341d0e5c195b` on 2026-11-13 UTC. The test
completed its before/after full hash checks, changed-boot-ID assertion and
missing-Pack rejection. The scope limitations above remain unchanged; this
observation is for that exact commit, not a blanket statement about later heads.

## Guest-created large-file writer candidate

The guest reboot test now includes a separate 17 MiB logical sparse input with distinct per-chunk markers. The guest runs the actual `put-file-large!` with an observed-generation condition and the pinned Linux Forest tool, reads and hashes both Packs before shutdown, reboots with a changed boot ID, reads and hashes them again, then requires `:missing-forest` after moving one guest-owned Pack aside. The 64-Pack prebuilt GiB case remains separate. The guest receives the exact release ZIP and binary already pinned by the hosted writer CI; `nix-ld` is enabled so the unmodified, digest-checked executable can run on NixOS.

On 2026-11-14, macOS arm64 and Babashka 1.12.218 ran the actual `create-large` writer against a fresh store using the existing macOS Forest tool (SHA-256 `e5fb23076a46c055142b3dbf3efa1ad5a68532d14419ad9994785986719b205f`). A new process recovered two Packs and matched the full 17,825,792-byte source SHA-256 `9f35811d162d0cc95c7288dc4589dbda480dc29719f4160c3289f382669dfd71`. A copied store with one Pack moved aside failed with `:missing-forest`. An earlier actual attempt failed while copying the tool with `No space left on device`; its retained store remained generation 1 with empty state. These are sparse synthetic bytes and are not a physical-throughput result.

The changed NixOS VM test has not been evaluated or run locally because Nix is unavailable. Only a successful exact-head CI run can establish the guest writer/reboot evidence. Even then it would cover this 17 MiB synthetic guest workload, not a guest GiB write, host OS cache loss, device power failure, Native I/O, signed basis or production qualification.
