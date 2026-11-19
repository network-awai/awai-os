# Awai PC A/B device, step by step (AWAI-3586)

Goal: an A/B image that installs next to the partitions already on a PC's NVMe and takes signed OTA
updates. The base is the upstream A/B reference device `lineage_virtio_x86_64` (GRUB boot control,
Virtual A/B), whose OTA behaviour is recorded in [../ota-reference-check](../ota-reference-check/README.md).

That device owns a whole virtio disk and addresses partitions by device name and number. This directory
holds the changes that remove those assumptions, and the installer for a shared disk.

**State: KVM only.** Nothing here ran on the 7735HS. The kernel still lacks the Desktop's NIC and GPU
drivers (`CONFIG_R8169`, `CONFIG_DRM_AMDGPU` are off).

## Patches

Apply to a synced source tree with `apply.sh <source tree root>`.

| Patch | Project (revision) | What it changes |
| --- | --- | --- |
| `patches/virtio-common-byname.patch` | `device/virt/virtio-common` (`e6f2a7d2`) | SELinux labels for `/dev/block/by-name/{super,misc,userdata,persist,metadata,boot_[ab],vendor_boot_[ab]}`; userdata is mounted from the partition named `userdata` instead of `/dev/block/vdb`. |
| `patches/virt-common-grub-partguid.patch` | `device/virt/virt-common` (`0e62edf1`) | GRUB takes the boot disk from where the `PERSIST` filesystem is, and finds `misc`, `vendor_boot_a/b` and `boot_a/b` by fixed GPT partition GUIDs. `EFI` and `BIOS` leave `AB_OTA_PARTITIONS`, and Android no longer mounts the ESP. |

Why the ESP leaves the A/B set: with `androidboot.boot_devices=any` every GPT partition on every disk
appears under `/dev/block/by-name/`. If an existing ESP is named `EFI`, an update could write to it.

Without the first patch the stock image on an NVMe disk reboots in a loop: `/metadata` cannot be
formatted (`mke2fs returned 1`, the device node has no label) and `/dev/block/vdb` does not exist.

The stock GRUB has no search by partition name. It has `probe --part-uuid` and `regexp`, which is what
the second patch uses. A disk without the fixed GUIDs (the stock `disk-vda.img`) keeps the stock numbers.

## Installer

`awai-pc-install.py` adds the Awai partitions to a disk that already has partitions:

```sh
awai-pc-install.py plan  <disk or image> <disk-vda.img from the build>
awai-pc-install.py apply <disk or image> <disk-vda.img from the build> --record record.json
```

- `plan` writes nothing and prints every sector range it would use.
- It copies each partition from the partition of the same name in the build's disk image. The Awai ESP
  is named `awai_esp`.
- It refuses when an existing partition already uses an Awai name, when no single free range is large
  enough, or when a planned range overlaps an existing partition.
- `apply` takes the sha256 of every existing partition before and after, and fails if one differs.

It has only been run against an image file. Running it on a real disk is a separate, approved step
(AWAI-3585 first reads the Desktop's partition table).

## KVM check (2026-11-19)

`kvm/shared-disk-test.sh` on a 64 GiB image with three stand-in partitions (ESP 512 MiB, ext4 24 GiB,
8 GiB of random data for LUKS). Their sizes are placeholders: the Desktop's real sizes are not known yet.

- Install: partitions 4 to 14 added, `existingUnchanged: true`
  ([evidence/install-record-kvm-20261119.json](evidence/install-record-kvm-20261119.json)).
- Boot from that disk as the only drive (QEMU `-device nvme`): GRUB printed
  `boot_a=(hd0,gpt12) boot_b=(hd0,gpt13) vendor_boot_a=(hd0,gpt10) vendor_boot_b=(hd0,gpt11)`, and
  Android reached `sys.boot_completed=1` on slot `_a`, build `awai-byname-v2`.
- After a clean shutdown the three stand-in partitions had the same sha256 as before the install.
- `kvm/nvme-kvm.sh` is the earlier check: the stock layout plus a `userdata` partition on one NVMe disk.

## Known gaps

- `init.virtio.rc` still creates `by-name` links to `vda1`, `vda7` and so on. On NVMe they point nowhere
  (`EFI`, `EFI_a`, `EFI_b`, `grub_boot_a`, `grub_boot_b`). Nothing uses them after the second patch.
- Existing partitions appear under `/dev/block/by-name/` with their own names. Android did not mount them.
- OVMF skipped the first ESP, which had no loader, and started GRUB from `awai_esp`. Real firmware may
  need a boot entry, or the PXE route may have to chain-load it.
- No real-hardware drivers or firmware, no release keys, and `ro.ota.allow_downgrade` is still set by
  LineageOS on this userdebug build.
