# Offline automatic internal-disk installation

1. Connect AC power and boot the new **offline** ISO. Internet is not needed
   for OS installation or the first internal-disk boot. Previously written
   USB sticks must be rewritten; earlier images downloaded/built on the PC.
   For NVMe select the **UEFI USB** entry in the firmware boot menu.
   BIOS-mode NVMe installation is refused; BIOS SATA/virtio uses GRUB.
2. The network screen opens automatically. Choose Wi-Fi (scan, select, masked
   password), Ethernet, or continue without networking. No command entry is
   needed. Already connected networks go straight to connection confirmation.
   See [network onboarding](network-onboarding.md).
3. Select the disk by its path, model, capacity and serial. This replaces the
   whole disk, including Windows and recovery partitions. USB, removable,
   hotplug, read-only, mounted, swap and mapped disks are excluded. Targets
   must be at least 16 GiB. No maintenance password is requested.
4. Before erasing, the installer checks that the complete prebuilt system and
   its Nix store references are on the USB. No `nix-build` or network downloads
   run on the PC. UEFI and BIOS installed systems are built when creating the
   ISO, with generic x86_64 storage drivers and Intel/AMD microcode/firmware.
5. Review the target again, acknowledge that its data will be erased, and press
   the red installation button. Back returns to disk selection without erasing.
   The recovery console fallback instead requires `ERASE /dev/<chosen-disk>`.
   Disk identity and usage are rechecked. GPT partitioning, formatting,
   copying of the shipped OS and installation of its bootloader run
   automatically. Network substituters are disabled. UEFI uses systemd-boot's
   fallback path; BIOS generates its GRUB menu and installs GRUB only onto the
   explicitly selected whole disk.
6. On success, press OK to restart. Remove the USB as the PC restarts and boot
   the internal disk. The network and registration screen opens automatically.
   “Register later” displays a completed-installation screen with reconnect and
   shutdown choices; offline continuation never blocks OS installation.
7. Choose a connection and continue to phone registration. Matching published
   Worker/Portal routes and migrations are still required. Scan its QR with a
   phone, compare the full Device ID and approve with your Murakumo Passkey.

Maintenance on Alt+F2 logs in locally as `root` automatically. Anyone with
physical console access can administer this node. Root's password is locked and
SSH is disabled; no empty-password remote login is enabled.

The installer assigns fresh filesystem UUIDs and records them in the selected
disk's boot entries. The prebuilt initrd maps only those UUIDs to its root and
boot devices; matching labels on another attached disk do not prevent
installation or select that other disk during boot. UUID collisions with
another disk are rejected before erasure.
Detected host settings are saved as `/etc/nixos/detected-hardware.nix` for later
review, and are not imported into the prebuilt generic system. To customize the
host later, review its generated configuration and rebuild with network access
or an appropriate complete local build cache.

Cancellation never automatically repeats installation. Failure after formatting
may leave a partial installation: use the recovery console and do not blindly
repeat erasure. Use `journalctl -u murakumo-install` and
`sh /etc/murakumo/preflight.sh` for service/hardware diagnostics.

Offline OS installation does not publish registration dependencies, qualify a
real phone Passkey ceremony or enable a model server/fleet worker. Physical
networking, GPU/model performance and actual inference remain separate checks.
