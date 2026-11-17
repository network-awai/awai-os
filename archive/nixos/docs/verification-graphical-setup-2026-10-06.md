# Graphical setup and disk-identity verification — 2026-10-06

The photographed failure was the installer rejecting another disk's shared
`MURAKUMO_ROOT` / `MURA_BOOT` labels. Runtime bca34a2 replaces that routing with
fresh filesystem UUIDs written to the selected disk's boot entries. Its generic
prebuilt initrd validates the parameters and registers root/boot aliases with
udev. Source review includes b955aca.

The native GTK4 interface runs in a private Weston/seatd session using software
rendering. Network, disk selection, destructive confirmation, copying,
completion and phone approval share one visual flow. The transport is a
root-private UNIX socket. Wi-Fi input is masked and never passed as a command
argument. Back on destructive confirmation returns to a fresh inventory.

35 source tests pass. Native UI fixture checks cover password entry, disk
reselection and cancellation of a QR approval screen without linking an
account. The 300-pixel QR screenshot decodes to the exact fixture URI. These
fixture screenshots used a diagnostic harness before the final image and are
not evidence of a real phone Passkey ceremony.

The first completed image exposed an early boot input-device discovery race:
Weston failed before input classification completed. The launcher now waits for
udev discovery before opening the compositor. Another final-build attempt ran
out of space in the task-owned build store. Two obsolete ISO store outputs were
removed; the cached final derivation then completed. Copying over a read-only
host ISO was refused, so the old local image was renamed and the new output was
copied to a fresh path. The final guest and host hashes match; neither failed
attempt was written to USB.

Final ISO: 2,303,950,848 bytes, SHA256
`9e68645d5d75071c3e65d6995181d4dff8051ccca8053f14fa5ef8cf67d1d6ef`.
Pinned nixpkgs: `f5c082a40f7571c266e74e80ae2e68aadd8a9fc7`.
See [artifact metadata](evidence/graphical-setup-2026-10-06/artifact.json).

Qualification uses QEMU UEFI with no network interface and two 24 GiB NVMe
disks. `GRAPHICAL-SELECTED` is `/dev/nvme1n1`; `GRAPHICAL-PRESERVE` is
`/dev/nvme0n1`. Disk enumeration is not assumed to follow attachment order.
The final ISO opens the graphical interface automatically. Pointer input
chooses offline installation, the selected disk, the acknowledgement checkbox
and the red installation button. Both disks carry the same filesystem labels
after formatting, with different UUIDs. OS installation completed without a
network interface. The same selected disk boots with the ISO removed, while
the other disk remains attached. Disk enumeration swaps after reboot:
`GRAPHICAL-SELECTED` becomes `/dev/nvme0n1`. Both `/` and `/boot` mount this
disk's UUIDs, and the udev aliases resolve to it. The retained configuration and
boot entries contain the same IDs. Both runtime source hashes match the
reviewed source. Selecting Register later opens the installed completion menu.

The other qcow2 disk's SHA256 remains exactly
`4a7526b2e1f15770c4eeaa6abcad3fc86e4d761fb2eaa6e64b9d086b3936a251`.
The installed VM shuts down from the graphical menu; the builder and media VMs
are also off. No other VMs or apps were closed. GTK logs a missing session-bus
warning; it did not prevent this flow. BIOS boot-entry validation is covered by
source tests and prebuilt image generation, but this new runtime was only
installed and rebooted end to end in UEFI mode.

This record does not qualify physical PC firmware, a real Wi-Fi radio, a real
phone account link, production registration deployment or fleet inference.
The user returned KIOXIA to the Mac after local qualification. The installed
passwordless helper reidentified serial `0022CFF6B899CA205987CBC4`, capacity
61,949,214,720 bytes, dynamically at `disk6`. ISO preflight passed. The helper
wrote and read back exactly 2,303,950,848 bytes. Both SHA256 values equal the
final ISO hash above. It exited successfully with `verified-and-ejected`;
subsequent external physical disk inventory was empty. No password prompt
was needed. The request was reset to check mode after completion. See
[USB result](evidence/graphical-setup-2026-10-06/usb-result.json).
