# ISO build and VM boot verification — 2026-09-26

## Image provenance

- Installer source: `network-awai/cloud-murakumo-usb-installer` commit
  `39e9cf4c5a7bfa1e24ef72831bd19aa646962a28`.
- NixOS channel revision: `f5c082a40f7571c266e74e80ae2e68aadd8a9fc7`
  (`nixos-version`: `26.05.10620.f5c082a40f75 (Yarara)`).
- Build: `./scripts/build-iso.sh /nix/var/nix/profiles/per-user/root/channels/nixos`
  in an isolated NixOS x86_64 KVM guest; exit code 0.
- ISO: `nixos-minimal-26.05.10620.f5c082a40f75-x86_64-linux.iso`,
  1,496,678,400 bytes; SHA-256
  `08e95e96622f8eb673c513f2a3f5ddc51254776ef790826d9347d78043e2cfb8`.
  The build guest and receiving host calculated the same hash.

## Boot checks

The ISO booted through SeaBIOS/ISOLINUX in a separate KVM guest with 3 GiB RAM
and 2 vCPUs. For the serial-only VM console, `console=ttyS0,115200n8` was
appended at the boot menu. The guest reached the NixOS login shell and
`systemctl is-system-running` reported `running`; `systemctl --failed`
listed no units.

The live image contained all three expected files under `/etc/murakumo/`:
`preflight.sh`, `node-base.nix`, and `configuration.example.nix`. Running
`sh /etc/murakumo/preflight.sh` returned 0, reported BIOS boot, the visible
CD-ROM and network/GPU devices, and ended with `No disk was modified.` The VM
had no target disk attached, so no installation was attempted.

This is a VM ISO boot check. Physical USB boot, UEFI boot, target-disk
installation, Radeon 680M/Vulkan, model serving, network recovery and rollback
remain unverified. The existing serving Ubuntu host was not reimaged.
