# Awai PC A/B device, step by step (AWAI-3586)

Goal: an A/B image that installs next to the partitions already on a PC's NVMe and takes signed OTA
updates. The base is the upstream A/B reference device `lineage_virtio_x86_64` (GRUB boot control,
Virtual A/B), whose OTA behaviour is recorded in [../ota-reference-check](../ota-reference-check/README.md).

That device owns a whole virtio disk and addresses partitions by device name and number. This directory
holds the changes that remove those assumptions, and the installer for a shared disk.

**State: KVM only.** Nothing here ran on the 7735HS. The kernel has the Desktop's NIC driver and builds
the AMD GPU driver as a module. Without a virtio GPU the image boots in the headless mode, with no picture
(see "Headless mode").

## Patches

Apply to a synced source tree with `apply.sh <source tree root>`.

| Patch | Project (revision) | What it changes |
| --- | --- | --- |
| `patches/virtio-common-awai-pc.patch` | `device/virt/virtio-common` (`e6f2a7d2`) | SELinux labels for `/dev/block/by-name/{super,misc,userdata,persist,metadata,boot_[ab],vendor_boot_[ab]}`; userdata is mounted from the partition named `userdata` instead of `/dev/block/vdb`. Kernel config fragment `awai-pc.config` for real PC hardware, and the Intel NIC modules in the boot-time load list. |
| `patches/virt-common-awai-pc.patch` | `device/virt/virt-common` (`0e62edf1`) | GRUB takes the boot disk from where the `PERSIST` filesystem is, and finds `misc`, `vendor_boot_a/b` and `boot_a/b` by fixed GPT partition GUIDs. `EFI` and `BIOS` leave `AB_OTA_PARTITIONS`, and Android no longer mounts the ESP. `ro.surface_flinger.enable_frame_rate_override=false` is removed (headless mode). |

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

## OTA on the shared disk (2026-11-19)

`kvm/shared-ota.sh` and `kvm/shared-ota2.sh`, results in
[evidence/shared-disk-ota-kvm-20261119.json](evidence/shared-disk-ota-kvm-20261119.json). After every
run the VM was shut down and the three stand-in partitions compared: unchanged each time.

| Check | Result |
| --- | --- |
| Full OTA v2 to v3 | `kSuccess`; after reboot slot `_a` to `_b`, build `awai-byname-v3`, slot b marked successful. |
| Full OTA, then `boot_b` (partition 13) zeroed with the VM off | GRUB: `Could not access kernel from active slot b. Switching active slot to a...`. Booted slot a with v2; Android cancelled the update. |
| Incremental v2 to v3, installed from `disk-vda.img` | **Failed**, `kDownloadStateInitializationError`: the source hash of `boot_a` did not match. |
| Incremental v2 to v3, installed from the target-files based image | `kSuccess` in 33 s; booted slot b with v3. |

### Install from target-files, not from `disk-vda.img`

An incremental package checks each source partition against the target-files it was generated from.
`disk-vda.img` is assembled from `PRODUCT_OUT`, and its `boot.img` is not the `IMAGES/boot.img` of the
target-files package (`vendor_boot.img` was the same). `make-tf-disk.sh <target_files.zip> <disk-vda.img> <out>`
writes `IMAGES/boot.img`, `IMAGES/vendor_boot.img` and a `super` built by `build_super_image` into a copy of
the disk image. Install from that. A release works the same way: sign target-files, then make both the
install image and the OTA packages from it.

## Real-hardware drivers (2026-11-19)

`awai-pc.config` adds to the reference kernel (`gki_defconfig` plus the virt fragments):

| Option | State | For |
| --- | --- | --- |
| `CONFIG_R8169`, `CONFIG_REALTEK_PHY` | built in | the Desktop's Realtek NIC |
| `CONFIG_E1000E`, `CONFIG_IGC` | modules, loaded at boot | Intel NICs; they depend on PTP, which is a module |
| `CONFIG_DRM_AMDGPU`, `CONFIG_DRM_AMD_DC` | module, **not loaded automatically** | Radeon 680M |
| `CONFIG_FB_EFI` | built in | console text on the firmware framebuffer |
| `CONFIG_PINCTRL_AMD`, `CONFIG_I2C_PIIX4`, `CONFIG_SENSORS_K10TEMP`, `CONFIG_SND_HDA_CODEC_HDMI` | built in / module | AMD platform |

Results in [evidence/hardware-drivers-kvm-20261119.json](evidence/hardware-drivers-kvm-20261119.json):

- Build `awai-byname-v5` installed on the shared disk (existing partitions unchanged) and booted with an
  **Intel `e1000e` NIC instead of virtio**: `sys.boot_completed=1`, `eth0` on driver `e1000e`, adb over it.
  The Realtek driver itself cannot be exercised in KVM.
- **Without a virtio GPU the system does not finish booting.** SurfaceFlinger aborts in a loop with
  `No matching frame rate modes for primary range`, and adb stays offline.
- The upstream **headless entry** (`androidboot.gpu=vkms androidboot.graphics=swiftshader`) fails the same
  way, also with the virtio GPU attached and also on `awai-byname-v2`, which has no hardware changes. So it
  is not caused by this patch.
- An earlier build with `CONFIG_DRM_SIMPLEDRM` failed the same way. That option was dropped, but the runs do
  not show that simpledrm was the cause.

The headless failure is fixed below. The run without a virtio GPU in the default entry was not repeated
after the fix.

## Headless mode (2026-11-19)

Cause of the crash loop: `device/virt/virt-common/configs/properties/vendor.prop` sets
`ro.surface_flinger.enable_frame_rate_override=false`. With it off, SurfaceFlinger only accepts a display
mode whose refresh rate is inside the render range the framework asks for, 0 to 60 Hz by default
(`config_defaultRefreshRate`). The vkms display of the headless entry reports 60.00384 Hz, so no mode is
left and `RefreshRateSelector::constructAvailableRefreshRates` aborts; the fallback that ignores the
render range applies the same test. Removing the property (the platform default is on) fixes it. A real
monitor mode slightly above 60 Hz would hit the same abort.

While SurfaceFlinger crash-loops there is no adb, because the network comes up with the framework.
`serial_console_function=console` in `grubenv` gives a shell on the serial port; `kvm/con.py` sends one
command to it.

Build `awai-byname-v6`, shared disk, Intel `e1000e` NIC, no virtio GPU (`-vga none -device ramfb`),
headless entry ([evidence/headless-kvm-20261119.json](evidence/headless-kvm-20261119.json)):

- `sys.boot_completed=1`, the only DRM card is vkms, SurfaceFlinger did not exit once, adb over `eth0`.
- Incremental OTA v6 to v7 in that configuration: `kSuccess`; after reboot slot `_b`, `awai-byname-v7`,
  still headless on `e1000e`; the three stand-in partitions unchanged.
- Default entry with the virtio GPU: still boots, SurfaceFlinger did not exit.

What this means for the Desktop: with a wired NIC and adb, an OTA can be checked there without a picture.
A picture needs the AMD driver with its firmware (`amdgpu/yellow_carp_*.bin`, 12 files, 1.7 MB in
linux-firmware 20261019) and the Mesa `radeonsi` stack, which KVM cannot validate. The Realtek NIC and
the firmware's boot path are also only testable on the machine.

## Known gaps

- `init.virtio.rc` still creates `by-name` links to `vda1`, `vda7` and so on. On NVMe they point nowhere
  (`EFI`, `EFI_a`, `EFI_b`, `grub_boot_a`, `grub_boot_b`). Nothing uses them after the second patch.
- Existing partitions appear under `/dev/block/by-name/` with their own names. Android did not mount them.
- OVMF skipped the first ESP, which had no loader, and started GRUB from `awai_esp`. Real firmware may
  need a boot entry, or the PXE route may have to chain-load it.
- No picture without a virtio GPU (headless only), no firmware files in the image, no release keys, and
  `ro.ota.allow_downgrade` is still set by LineageOS on this userdebug build.
