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
| `patches/virtio-common-awai-pc.patch` | `device/virt/virtio-common` (`e6f2a7d2`) | SELinux labels for `/dev/block/by-name/{super,misc,userdata,persist,metadata,boot_[ab],vendor_boot_[ab]}`, kernel config fragment `awai-pc.config`, and Intel NIC modules in the boot-time load list. |
| `patches/virtio-userdata*.patch` | `device/virt/virtio-common` | Mounts userdata by partition name while preserving the existing ext4 and f2fs mount options. |
| `patches/virt-common-awai-pc.patch` | `device/virt/virt-common` (`0e62edf1`) | GRUB takes the boot disk from where the `PERSIST` filesystem is, and finds `misc`, `vendor_boot_a/b` and `boot_a/b` by fixed GPT partition GUIDs. `EFI` and `BIOS` leave `AB_OTA_PARTITIONS`, and Android no longer mounts the ESP. `ro.surface_flinger.enable_frame_rate_override=false` is removed (headless mode). |

| `patches/vendor-lineage-no-ota-downgrade.patch` | `vendor/lineage` | Removes LineageOS's opt-in to older A/B payloads on non-`user` builds. |

Use a dedicated LineageOS source checkout for these patches. The vendor change affects LineageOS
products built from that patched checkout. The installed image must report an empty
`adb shell getprop ro.ota.allow_downgrade`. Validate the rejection paths on the Awai PC NVMe
guest using an older OTA signed with its test key and a current OTA signed with a different test key.

For `virtio-common`, `apply.sh` selects a matching userdata fstab patch before
changing any source files. Both variants use the userdata GPT name and enable
`checkpoint=block` for ext4. Older Awai source trees without the ext4 flag are
updated on reapplication. F2FS keeps `checkpoint=fs`. The PC kernel must include
`CONFIG_DM_BOW=y` for ext4 checkpoints.

Why the ESP leaves the A/B set: with `androidboot.boot_devices=any` every GPT partition on every disk
appears under `/dev/block/by-name/`. If an existing ESP is named `EFI`, an update could write to it.

Without the first patch the stock image on an NVMe disk reboots in a loop: `/metadata` cannot be
formatted (`mke2fs returned 1`, the device node has no label) and `/dev/block/vdb` does not exist.

The stock GRUB has no search by partition name. It has `probe --part-uuid` and `regexp`, which is what
the second patch uses. A disk without the fixed GUIDs (the stock `disk-vda.img`) keeps the stock numbers.

## Shipping debug lockdown (AWAI-3682)

**State: patches only. Not built, not booted.** `apply.sh` does not call this; run it yourself on the
dedicated checkout, after `apply.sh`:

```sh
apply-shipping-debug-lockdown.sh --check <source tree root>   # changes nothing
apply-shipping-debug-lockdown.sh <source tree root>
```

It checks all three patches first and applies none if one does not match. A second run reports `applied`.

| Patch | Project (upstream revision it was written against) | What it changes |
| --- | --- | --- |
| `patches/virt-common-user-no-adb-tcp.patch` | `device/virt/virt-common` (`5da81829` plus `virt-common-awai-pc.patch`) | `service.adb.tcp.port=5555` moves from `product.prop` to the product makefile and is set only when the variant is not `user`. |
| `patches/mainline-common-user-no-insecure-debugging.patch` | `device/mainline/common` (`e237088e`) | `androidboot.insecure_adb` and `/metadata/.enable_insecure_debugging` are honoured only in debuggable builds. A `user` build ignores both. |
| `patches/build-no-trade-in-mode-trigger.patch` | `build/make` (`90d00638`) | Removes `DeviceDiagnostics`, the app that starts ADB trade-in mode during setup, from `handheld_system.mk`. This affects every product built from the checkout. |

Why, and what each route does without the patch:
[debug route design](../../../docs/otehon/android-debug-routes-design-20261121.md).

What was checked (2026-11-21, on the Mac, against clones of the three upstream projects at the revisions
above): `--check` reports `pending` and leaves the trees clean; a run applies all three; a second run
reports `applied`; with one project edited so its patch no longer fits, the script exits 1 and changes
nothing.

What was not checked: the revisions on the build host (they may differ, in which case the script reports
`mismatch`); that the tree builds; that `product_variables.debuggable` selects the flag as intended; that a
`user` image boots, finishes setup and shows no ADB at the Welcome screen; that development `userdebug`
images still serve ADB on 5555. Those are checks V1, V2 and V7 in the design document.

## PC installer and OTA host checks

With Bazelisk and Python 3 on the host, run both regression suites using the
Bazel version in `.bazelversion`:

```sh
bazel test //android/desktop/pc-ab-device:pc_verification
```

For a focused run, use `:installer_test` or `:ota_feed_test` in the same
package. Each target declares its Python sources and runs locally. These suites
cover installer planning and OTA metadata checks. The AOSP build, signing and
on-device acceptance continue to use their documented release workflows.

## Installer

`awai-pc-install.py` adds the Awai partitions to a disk that already has partitions:

```sh
awai-pc-install.py plan  <disk or image> <disk-vda.img from the build>
awai-pc-install.py apply <disk or image> <verified install image> \
  --source-sha256 "$INSTALL_IMAGE_SHA256" --record record.json
```

- `plan` writes nothing and prints every sector range it would use.
- It copies each partition from the partition of the same name in the build's disk image. The Awai ESP
  is named `awai_esp`.
- It requires 512-byte logical sectors on both the source and target and refuses to use the same
  file or device for both. It also refuses an existing Awai partition name, insufficient contiguous
  free space, or an overlap.
- `apply` rejects a source image that is shorter than the partitions it needs before changing the GPT.
  It hashes complete existing partitions before and after. It also reads back new GPT entries,
  fixed GUIDs, copied data and the zeroed prefix of new empty partitions. A success record includes
  the verified ranges and the supplied release digest. The record path must be new.

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

## Updater feed in the release build (AWAI-3064)

Configure the pinned LineageOS Updater checkout before building the Awai PC release
`target-files`. Supply the approved HTTPS URL for the selected release channel.
Updater supports the `{device}`, `{type}`, and `{incr}` placeholders. Keep these
quoted when passing a template.

```sh
AWAI_OTA_FEED='https://ota.awai.network/v1/pc/pilot/{device}/{incr}/builds.json'
python3 android/desktop/pc-ab-device/updater-feed.py configure-release \
    "$ANDROID_BUILD_TOP/packages/apps/Updater" "$AWAI_OTA_FEED"
git -C "$ANDROID_BUILD_TOP/packages/apps/Updater" diff --check
```

On the PC pilot, the Updater preference **Automatic PC maintenance** is off by
default. Enabling it requires scheduled checks and streaming. The worker uses a
fresh offer from the pilot feed and an HTTPS package under
`ota.awai.network/v1/pc/pilot/`. UpdateEngine verifies the A/B payload.
It waits for completed setup, an inactive screen, and a validated, unmetered
connection. It uses external power on devices with a battery. The first
automatic reboot check is scheduled about 20 minutes after UpdateEngine accepts
the payload. Checks back off if the device is in use, and normal scheduled
checks can resume later. Automatic reboot requires the same offer in the fresh
feed and an UpdateEngine completion marker belonging to an automatic update.
Manual update and restart remain available through Updater.

Check the final signed A/B target-files against the SHA-256 from the signing
record. Use Android SDK build-tools `aapt2` on PATH:

```sh
python3 android/desktop/pc-ab-device/updater-feed.py verify-target-files \
    "$SIGNED_TARGET_FILES" "$AWAI_OTA_FEED" \
    --sha256 "$SIGNED_TARGET_FILES_SHA256" --device virtio_x86_64
```

This check reads the actual APK resources, A/B partition set and build
properties for the selected device. Verify the Android signing certificates
as part of the signing workflow. Confirm the installed build contacts the
expected feed. Use the local signing environment with the build's AOSP releasetools on PATH
to generate the full OTA and verify it before the output is made available:

```sh
python3 android/desktop/pc-ab-device/updater-feed.py generate-ota \
    "$SIGNED_TARGET_FILES" "$OTA_ZIP" --key "$OTA_KEY_BASENAME" \
    --certificate-sha256 "$OTA_CERTIFICATE_SHA256" \
    --target-sha256 "$SIGNED_TARGET_FILES_SHA256" --require-streaming > "$OTA_VERIFICATION_RECORD"
```

The key basename refers to the private key and public certificate available
inside the local signing environment. For a delta, also pass the exact signed
source target-files and SHA-256 with `--source-target-files` and `--source-sha256`.
The command makes a new output only after both signature checks pass.

Before publishing an already-produced package, use the build's AOSP releasetools on PATH
to verify the OTA with the public certificate pinned in the signing record:

```sh
python3 android/desktop/pc-ab-device/updater-feed.py verify-ota \
    "$OTA_ZIP" "$OTA_CERTIFICATE" "$SIGNED_TARGET_FILES" \
    --certificate-sha256 "$OTA_CERTIFICATE_SHA256" \
    --target-sha256 "$SIGNED_TARGET_FILES_SHA256" --require-streaming > "$OTA_VERIFICATION_RECORD"
```

For a delta, also pass `--source-target-files "$SIGNED_SOURCE_TARGET_FILES"`
and `--source-sha256 "$SIGNED_SOURCE_TARGET_FILES_SHA256"`. The verifier checks
both the ZIP and A/B payload signatures and binds the package to its exact
build fingerprints and incremental versions. Use the verified OTA SHA-256
from the record to create the feed JSON:

```sh
python3 android/desktop/pc-ab-device/updater-feed.py make-index "$OTA_ZIP" "$OTA_URL" \
    --sha256 "$SIGNED_OTA_SHA256" --device "$OTA_DEVICE" \
    --release-type "$OTA_RELEASE_TYPE" --version "$OTA_VERSION" --require-streaming > "$FEED_INDEX"
```

Use the OTA target device and the installed build's Lineage release type and
version. Pass `--source-build` with the exact source incremental ID for a delta
and publish it at the feed path for that source. Omit the flag for a full OTA.
The index command checks the digest from the signing record and the archive
metadata. For automatic PC maintenance, require usable streaming ranges in both
the signature verification and index commands. The generator always checks
these ranges, including the Updater limit for payload properties.
The updater and Android still verify the signed package on device.
Retain a record of feed detection, apply, reboot, recovery, and rollback on the same PC.

The pilot endpoint is backed by the dedicated Cloudflare R2 bucket
`awai-os-ota`. Publish the verified ZIP at a digest-qualified object path and
check its public bytes and HTTP Range response before publishing the index.
Serve the mutable index as `application/json` with `Cache-Control: no-store`.
To stop offering updates, replace the affected index with `[]` and verify the
public response. The pinned Awai Updater removes undownloaded cached offers
after a successful empty response. Updates already started and saved local
packages are retained. A failed request does not withdraw an otherwise eligible cached offer. Keep
the signed ZIP for diagnosis and recovery.

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

## OTA rejection on the shared NVMe disk (2026-11-20)

Build `awai-byname-v8-rollback-policy` omitted `ro.ota.allow_downgrade` from all eight
`build.prop` files in target-files and from the running guest. Each case used a separate shared
NVMe install under QEMU/KVM with the headless SwiftShader entry and an `e1000e` NIC.

| OTA package | Update engine result |
| --- | --- |
| v7 full OTA, signed with the device's test key | `kPayloadTimestampError (51)` |
| v8 full OTA, signed with a separate test key | `kDownloadPayloadPubKeyVerificationError (18)` |

Both guests rebooted into v8 on slot `_a` with `sys.boot_completed=1`. After shutdown, all three
protected partitions matched the SHA-256 hashes recorded at installation.
[Evidence and artifact digests](evidence/ota-rejection-kvm-20261120.json).

## Known gaps

- `init.virtio.rc` still creates `by-name` links to `vda1`, `vda7` and so on. On NVMe they point nowhere
  (`EFI`, `EFI_a`, `EFI_b`, `grub_boot_a`, `grub_boot_b`). Nothing uses them after the second patch.
- Existing partitions appear under `/dev/block/by-name/` with their own names. Android did not mount them.
- OVMF skipped the first ESP, which had no loader, and started GRUB from `awai_esp`. Real firmware may
  need a boot entry, or the PXE route may have to chain-load it.
- No picture without a virtio GPU (headless only), no firmware files in the image, and no release keys.
