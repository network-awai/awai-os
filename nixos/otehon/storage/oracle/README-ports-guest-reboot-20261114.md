# Explicit ports: guest reboot gate, 2026-11-14

The NixOS reboot test now asks the guest to create a two-Pack group via
`publish-ports!`, verifies it before shutdown, and makes that group's read the
first task-data read after the guest's boot ID changes. It then withholds one
guest-owned Pack and requires `:missing-forest`. The reader is given a missing
writer executable, checks the published ref, all five byte/CID pairs and the
two physical archives. The earlier scoped-API case remains separate.

On the local macOS host, the previously explicit-ports-written fixture was read
in a fresh Babashka process with the writer executable absent: five blocks,
two Packs, pass. A separate copy with one Pack withheld was rejected with
`:missing-forest`. The original fixture was preserved. These host results do
not prove the guest gate passed: Nix was unavailable locally, so the actual
NixOS guest execution is pending exact-head CI. Guest reboot does not clear the
host's caches and does not demonstrate physical power-loss durability, Native
I/O, or production qualification.
