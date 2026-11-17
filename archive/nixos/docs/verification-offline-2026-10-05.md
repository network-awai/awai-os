# Offline installer verification — 2026-10-05 (Asia/Tokyo)

## Reviewed image

- Runtime source: `45bd707bb0cf795efd38b0523a84384016a3e622`
- nixpkgs: `f5c082a40f7571c266e74e80ae2e68aadd8a9fc7`
- ISO: `/Users/junkawasaki/github/murakumo-usb-auto-install-qa/murakumo-offline-installer.iso`
- Length: `1970044928` bytes
- SHA-256: `7d13905805601464f53073414b8343073004245410a1c2b4d6831cfe57bcca86`
- Guest build and host file hash matched. Build exited 0.
- UEFI system: `/nix/store/7z7sv3riiylhk8095zpgsx037pmbmhmv-nixos-system-murakumo-node-26.05pre-git`
- BIOS system: `/nix/store/2gmkz7bnfa9b6fx6ijcb6l30522gkk60-nixos-system-murakumo-node-26.05pre-git`

Both installed systems and their closures are included in the ISO. The PC
checks the selected closure before erasing, then uses `nixos-install --system`
with remote substituters disabled. No OS compilation occurs on the PC.
Creating the ISO used network access; installing it did not.

## Actual offline VM checks

Both QEMU installation runs used `-nic none`: no virtual Ethernet device or
network backend was present. The 9p output share is a local evidence mount,
not an Internet connection. Each installed disk was then booted again without
the ISO, still with `-nic none`.

| Case | Installation | Same-disk boot without ISO |
| --- | --- | --- |
| UEFI, 24 GiB QA NVMe | Completed offline | Completed offline |
| BIOS, 24 GiB QA virtio disk | Completed offline, GRUB installed | Completed offline |

Both first boots reached `multi-user.target`; `systemctl is-system-running`
returned `running`, with zero failed units. The registration service was
`Type=simple`, active and waiting for a default route. Its screen stated
“Murakumo OS is installed. Waiting for network for account registration.”
Network state contained only loopback and the local Tailscale virtual interface,
with no default route. OS boot completion was not blocked by account registration.

Ctrl+Alt+F2 automatically logged into the local root console. `passwd -S root`
reported `L`; SSH was not enabled. No maintenance password was requested during
installation. UEFI mounted root from NVMe partition 2 and `/boot` from partition
1; BIOS mounted root from virtio partition 2. Configurations and detected
hardware were retained under `/etc/nixos`. No installation-media marker remained
in the installed OS.

Fourteen Node tests passed, including changed/mounted/USB disk refusal,
BIOS-NVMe refusal, conflicting reserved labels, invalid offline manifests,
and registration receipt validation. Nix configuration evaluation passed for
both modes. The actual no-NIC ISO runs exercised copying the full store closure,
bootloader installation and subsequent disk boot, beyond configuration checks.

## Local evidence and boundaries

Evidence directory: `/Users/junkawasaki/github/murakumo-usb-auto-install-qa`.
Key files: `offline-build.log`, `offline-config-check.log`,
`offline-uefi-during-install.log`, `offline-bios-during-install.log`,
`offline-uefi-node-checks.log`, `offline-bios-node-checks.log`,
`offline-media-result.png`, `offline-bios-completed.png`,
`offline-installed-check.png`, `offline-bios-node.png`, and the four
`boot-offline-*.sh` scripts (UEFI/BIOS, media/installed).
The during-install inventories were taken after formatting, not before erasure.
All disks in these tests were task-owned VM files. Physical PC disks were not
accessed. Task-owned builder and QA VMs were powered off after their checks.

USB writing is a separate step: this record alone does not claim the KIOXIA
contains this offline image. Previous USB images required network access and
must be rewritten. Offline OS installation does not complete real account
linking, publish Worker/Portal dependencies, configure a model server, or prove
fleet inference. No push, PR, merge or production deployment was performed.
