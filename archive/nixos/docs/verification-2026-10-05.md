# Guided installation verification — 2026-10-05

Local implementation review and explicitly authorized USB update only. No push,
PR, merge, production deployment or physical PC disk operation occurred.

## Artifact

- Runtime source: `71723c1` (based on frozen account-link review `bf6e9adc`).
- nixpkgs: `f5c082a40f7571c266e74e80ae2e68aadd8a9fc7`.
- ISO: `murakumo-auto-install-71723c1.iso`, 1,662,976,000 bytes.
- SHA-256: `fd12332d0bb729cb6c601cbf7773c24066cf4cc174a2064f6bbc155428b08d4f`.
- Installer script SHA-256, matched from actual booted ISO:
  `3447902ea6043343f8b6fc3e09a477f945ff402b8d5ddcd0dcace216ce3661b3`.
- Built with the pinned Linux builder and zstd compression level 1. Host and
  guest independently matched the ISO hash.
- Artifact/evidence directory: `/Users/junkawasaki/github/murakumo-usb-auto-install-qa`.

## Verified checks

- 12 Node tests passed: account-link protocol and disk-selection safety.
- Generated BIOS (virtio disk) and UEFI (NVMe) configurations parsed and fully
  evaluated with pinned NixOS. `release-config-check.log` ends `CHECK_EXIT=0`.
- Actual final ISO booted via UEFI; selected only the 24 GiB QA NVMe and began
  pre-erasure preparation. ISO script hash matches the reviewed source.
- Actual final ISO booted via BIOS with only an NVMe candidate: refused before
  installation. QEMU block statistics show target `wr_bytes=0`,
  `wr_operations=0` (`bios-guard.png`, `bios-guard-blockstats.log`).
- Earlier isolated fixture checks exercised cancellation and build failure
  without erasure, USB exclusion and final confirmation before formatting.
  The successful BIOS fixture boot used a virtio bus; it is not evidence for
  BIOS-mode NVMe boot. The final code requires UEFI for NVMe.

## Final artifact installation and reboot

The unmodified final ISO prepared NixOS, displayed the explicit
`ERASE /dev/nvme0n1` gate and then installed onto the QA-only 24 GiB NVMe.
`release-approval.png` and `release-install-completed.png` record the gate and
success. The installer's reboot exited the test VM normally. It was restarted
with the same NVMe disk and UEFI variables, with no ISO or installation media.
UEFI selected the NVMe fallback bootloader and NixOS reached multi-user mode.

- `/` mounted from `/dev/nvme0n1p2` (ext4); `/boot` from `/dev/nvme0n1p1` (vfat).
- Maintenance login succeeded with the QA-only dummy password.
- Password hash file is mode 0600, owned by root; root password is set.
- Installation-media marker absent from target; no reinstallation on reboot.
- Registration service started, then failed closed with `invalid registration
  flow`. This confirms the production integration gap; no real account linked.
- Evidence: `release-node.png`, `release-maintenance.png`,
  `release-node-checks.log`, `release-installed-serial.log`.
- Test VMs, builder and registrar were stopped after verification. No unrelated
  VM or app was stopped.

## Outstanding acceptance

Physical PC installation and recovery remain unqualified. Registration requires
matching published Worker/Portal routes and migrations; frozen local QA alone
cannot link a real account. Real phone Passkey, GPU/model service and actual
fleet inference remain separate acceptance checks.

## KIOXIA USB update

After explicit user approval on 2026-10-05 (Asia/Tokyo), KIOXIA TransMemory
61,949,214,720 bytes, external physical USB `/dev/disk6`, was re-identified,
erased and written with the final ISO. macOS initially refused the raw write
from the automation context; Terminal authentication enabled it. An interrupted
write was restarted from byte zero before the final successful run.

The final write completed with 1,662,976,000 bytes. Exactly that length was read
back and its SHA-256 matched the ISO:
`fd12332d0bb729cb6c601cbf7773c24066cf4cc174a2064f6bbc155428b08d4f`.
`diskutil eject` succeeded. Evidence: `usb-write-20261005/result.json` and
`usb-write-20261005/terminal-write.log` in the artifact directory. The USB can
be unplugged. Physical PC installation and production registration are still
not established by this media update.
