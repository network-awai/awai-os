# A/B OTA check on the upstream reference device under KVM (AWAI-3064)

This records what signed A/B OTA does today on `lineage_virtio_x86_64` (LineageOS 24.0, userdebug), the
A/B reference device in the same source tree as the Awai PC build. It uses GRUB boot control
(`hardware/mainline/common/grub`), dynamic partitions and Virtual A/B.

It is **not** the Awai PC image: `lineage_Generic_x86_64` has `AB_OTA_UPDATER := false` and no update_engine.
Nothing here ran on the 7735HS Desktop.

## What was run (2026-11-19)

Build host: Vultr `vc2-16c-64gb`. KVM host: Vultr bare metal, Xeon E-2286G, QEMU 8.2.2 with KVM.

1. `ab-build.sh`: `m target-files-package otatools diskimage-vda` for `lineage_virtio_x86_64-userdebug` (v1).
   `ROOMSERVICE_DRYRUN=true` is needed: without it `breakfast` fetches `external/alsa-lib` and
   `external/alsa-ucm-conf` again, and they collide with `external/mainline-hw-deps/`.
   The kernel source `kernel/virt/virtio` (branch `virtio/android17-6.18`) must be present.
2. `ab-ota.sh`: build v2 (same source, `BUILD_NUMBER=awai-ota-test-v2`, new `BUILD_DATETIME`), then four packages with
   `ota_from_target_files`: v2 full, v1→v2 incremental, v2 full signed with a throwaway key, and v1 full (older).
   Packages are signed with the AOSP test key, the key the unsigned v1 disk image trusts.
3. `ota-kvm.sh`: run the v1 disk under KVM (virtio disks, OVMF). `prepare` sets `android_insecure_adb=1`
   in the device's `grubenv` so adb works without the on-screen confirmation. That is for this VM only.
4. Apply with AOSP `system/update_engine/scripts/update_device.py`. This build has no `su` and adb is
   already root, so the copy used had `su 0` removed.
5. `ota-more.sh`, `ota-more2.sh`: incremental, interrupted update, and a new slot that cannot boot.

## Results

[evidence/ota-reference-kvm-20261119.json](evidence/ota-reference-kvm-20261119.json) has the values;
`evidence/raw/` has the result lines and log extracts.

| Check | Result |
| --- | --- |
| v2 full OTA on v1 | `kSuccess` in 96 s. After reboot: slot `_a` → `_b`, version `awai-ota-test-v2`, slot b marked successful, snapshot merge `MergeCompleted`. |
| Package signed with another key | Refused: `kDownloadPayloadPubKeyVerificationError`. The active slot did not change. The refusal came after the payload was written to the inactive slot (78 s). |
| Older package (downgrade), as built | **Applied.** LineageOS sets `ro.ota.allow_downgrade=true` on non-`user` builds (`vendor/lineage/config/common.mk`). The slot switch was reverted before reboot. |
| Older package with `ro.ota.allow_downgrade=false` | Refused in 3 s: `kPayloadTimestampError`. The property was changed inside the VM through `adb remount`. |
| New slot cannot boot | After the update, `boot_b` was zeroed from the host with the VM off. GRUB printed `Could not access kernel from active slot b. Switching active slot to a...` and booted slot a with v1. Slot b was marked not bootable and Android cancelled the update. |
| Update interrupted (VM killed at 41%) | The VM booted slot a with v1. Running the update again resumed at 35% and then failed: `kNewRootfsVerificationError`. After `update_engine_client --reset_status`, a third run succeeded and the VM booted v2 from slot b. Same result with `cache=unsafe` and `cache=writeback` disks. |
| v1→v2 incremental OTA | **Failed**: `kDownloadStateInitializationError`, first on the source hash of partition `EFI`. Later work (AWAI-3586, [../pc-ab-device](../pc-ab-device/README.md)) showed two causes: `EFI` is in `AB_OTA_PARTITIONS` and mounted read-write, and the disk image's `boot.img` is not the one in target-files. With the ESP out of the A/B set and the install made from target-files, an incremental package applied. |

## What this means for the Awai PC image

- A release must not allow downgrades: build `user`, or drop `ro.ota.allow_downgrade` in the Awai fork.
- After a hard power loss a resumed update can fail verification. The updater has to reset and start
  over by itself; whether the LineageOS Updater app does that was not checked.
- Incremental packages need every A/B partition to stay byte-identical to the target-files they were
  generated from. Install from target-files images, and keep a writable ESP out of the A/B set.
  Full packages are not affected.
- The reference device owns a whole disk with fixed partition numbers. The Desktop's NVMe has three
  existing partitions that must stay, so the Awai PC device needs partitions found by name.

## Not shown

- anything on real hardware, or on the Awai PC image;
- release keys: the OTA packages use the AOSP test key;
- a disk image made from signed target-files;
- a new slot whose kernel boots but whose Android does not (the retry-count path);
- the Updater app and an update feed: updates were pushed over adb.
