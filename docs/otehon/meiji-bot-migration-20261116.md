# Meiji Bot guest migration — AWAI-2820

The new `meiji-bot-vm` profile retains the bounded fixed-command physics
executor. It reads the replacement operator public key from the host-owned
key disk, uses the distinct `meiji-root` partition label and imports existing
Pack/results before enabling SSH. A missing/read-write history disk or existing
unmarked target state fails closed. Restart validates the imported Pack and
retains newer work. Source cron/paused settings and job IDs are not rewritten.

Local history tests: 2 tests / 7 assertions passed. Aarch64 Linux Nix
instantiation and image build passed on the dedicated `awai-meiji-builder` VM,
with pinned nixpkgs f5c082a and Nix 2.31.2. Image output:
`/nix/store/7n3pmv3sbaapai8g72c92hm6ivf2gfgs-awai-meiji-bot-vm-0.2.0-AWAI-2820`.
Production guest boot/history recovery and Bot continuation remain pending.

The standard repart `auto` mode discovered loop devices then failed mounting
vfat inside a user namespace. The profile explicitly uses `--offline=yes`
with the same pinned filesystem tools; it completed in 53 seconds. The
Ubuntu builder's AppArmor unprivileged-userns restriction was temporarily
changed only for this isolated build and restored by an EXIT trap; no existing
guest or production host protection was changed. No manual image assembly or
native/runtime fallback was used. See [systemd 260 repart](https://www.freedesktop.org/software/systemd/man/260/systemd-repart.html).

Before an owned old guest stops, CAS-hold its five existing VM enrollments only
if their cursors are unchanged/completed. Save the exact old enrollment/cursor
plan encrypted before applying the hold. Preserve old launch configuration,
key disk and working disk. Attach that old working disk read-only to Meiji,
verify imported original results, and restore the exact original enrollments
before resuming a due original slot. Unknown outcomes never transfer.

At 09:09 UTC, vm-benjamin booted the signed Meiji image and completed the
readonly Pack history import with `OTEHON_BOOT_REPORT ... failed=0`.
The owned hypervisor is running with 2 vCPUs / 1024 MiB. Its original node
keys stayed on benjamin, and the old working disk's digest remained
`9ff55a9f7ab2df14a5463a24c9d903653cf8abcbce2c2a0a14179491d13cb17b`.
Five VM enrollments remain maintenance-held; no new Bot work is claimed yet.

Two fail-closed cases were observed and corrected: launchd removes a stopped
job asynchronously (now polled, including resume after a confirmed stop);
UEFI initially selected the readonly history disk's EFI, whose root mount was
rejected. The main Meiji disk now has explicit bootindex 1 with strict boot
ordering. Reconfiguration requires the same five CAS holds and unchanged
history digest. Existing unrelated guests were not stopped.
