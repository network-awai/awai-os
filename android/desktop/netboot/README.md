# Diagnostic RAM live boot — AWAI-2992

This is an isolated engineering trial, not the Awai AOSP release installer.
The candidate and upstream source limits are in `../aosp-architecture.md`.
Do not replace the existing Nix delivery profile or default boot entry as a
side effect of building these files.

`ipxe.nix` embeds one bounded direct-LAN endpoint; it has no installer action.
`init.sh` connects to export `awai2992` read-only, admits temporary userdata and
RAM-copy modes only, and rejects visible local NVMe/SATA/MMC/virtio disks. Boot
parameters also blacklist their common drivers. This is a diagnostic guard,
not proof of protecting every possible disk controller or a security boundary
against the unverified image. The firmware must select this trial explicitly.

The bootstrap requires a static x86_64 BusyBox at `/awai/busybox`, including
`nbd-client`, `ip`, `timeout`, `insmod` and `blockdev`. Stage `e1000.ko`,
`r8169.ko`, `realtek.ko`, `phy_package.ko`, `mii.ko` from the **same candidate kernel** in `/awai/`;
`nbd.ko` remains in the original ramdisk's `/lib/modules/`. Never mix host Nix
kernel modules with the Android kernel. Record source/byte hashes of every
staged input. Include `rtl_nic` firmware from the same firmware.img under
`/awai/firmware/rtl_nic`; the bootstrap temporarily selects that path before
loading the NIC. Realtek PHY requires `phy_package.ko` first. Engineering tool pin used: nixpkgs
`f5c082a40f7571c266e74e80ae2e68aadd8a9fc7`, static BusyBox1.37.0, lz4 1.10.0.

Place `init.sh` at `/awai-netboot`, mode0755. Decode the **entire concatenated**
original ramdisk with `lz4 -dc`; create an additional newc cpio of the overlay;
concatenate the original decoded cpio with the overlay and compress the result
using legacy `lz4 -l -z`. Appending raw cpio after the legacy-compressed input
was not accepted by this kernel. Keep the original image unchanged.

Serve the verified ISO using `qemu-nbd --read-only --persistent --shared=2
--export-name awai2992 --format=raw` on port10829. Bind to loopback for a VM or
the explicitly selected direct-LAN interface for a physical trial, never an
unrestricted interface. Serve only kernel/initrd/iPXE artifacts on port18090.
There is no browser app proxy or external inference service in this path.

Two integration details were measured in the isolated VM:

- BusyBox defaults to 4096-byte NBD sectors; ISO9660 rejects that size here.
  The bootstrap selects512-byte sectors.
- `generic_init` must mount sysfs itself, so the bootstrap unmounts its own
  `/sys` and `/proc` before handing off. Leaving sysfs mounted caused an early
  fatal error.

A continuing NBD root stalled when Android reconfigured Ethernet. The tested
solution copies system and firmware images to RAM before Android startup.
A diskless KVM direct-kernel VM then reported API37, bootcomplete1 and tmpfs
userdata, and displayed the installed Awai Home. That is the network root stage,
**not UEFI network boot**; the full UEFI→iPXE path is validated separately.
The trial VM uses6144MiB RAM; no production minimum is inferred from this run.
Physical AMD graphics/network and the final Awai ROM remain separate gates.

On2026-11-16, the full UEFI→DHCP/TFTP→iPXE→HTTP kernel/initrd→read-only
NBD→RAM-copy chain also booted the isolated VM. API37 and bootcomplete1 were
read back; all three checked APKs installed and Home displayed1280×800. The VM
had no hard disk or host filesystem. `artifacts-20261116.json` records the exact
served files and overlay input hashes. Physical LAN boot is still separate.
