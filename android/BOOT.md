# Booting Awai OS on Android

Use this page to find the right way to run Awai OS on Android today. The
[platform decision](../docs/otehon/aosp-platform-decision-20261117.md) holds the
target architecture and the remaining release gates.

## Current status

There is **no Awai OS release image yet**: no signed ROM with release keys,
no `Awai OS` entry in Settings, and the **persistent install is not yet
shown to boot**. (AWAI-3060, 2026-11-19, records the source build reaching
Android and adbd on the Desktop over netboot; that was a netboot / RAM Live
run, not a persistent install.) What exists today is narrower:

**Exists (evidence, KVM/VM only):**
- The USB/PXE installer for the PC (installer UI and PXE install profile in
  `desktop/pxe-install/` and the USB PC installer, including the screen
  front end from PR #501).
- A/B OTA behaviour evidence in KVM for the Awai PC A/B device
  (`desktop/pc-ab-device/`, AWAI-3586/3638: PR #312, #330), built with test keys.
  The upstream A/B reference check is in `desktop/ota-reference-check/`.

**Does not exist:**
- A release image.
- A signed OTA with release keys (all OTA/target-files evidence so far is
  test-key signed).
- A persistent install shown to boot (the AWAI-3060 netboot run does not
  count as one).
- `Awai OS` in Settings.

Today, Awai OS runs as the Awai apps (Home, Store, Yotei, Itonami, Murakumo)
and system overlays on top of a base system:
- a pinned Google SDK emulator image
- a pinned, unofficial PC Live image
- the test phone's existing community ROM

The source-pinned, signed Awai AOSP build is tracked in
[AWAI-2992](https://linear.app/kotobalabs/issue/AWAI-2992).

The only GitHub release, now titled "[Deprecated] Awai OS 0.6.0 — NixOS x86_64
preview (archived)", is the old NixOS USB image ([archive](../archive/nixos/README.md)).
It is not an Android image.

A [derived development image](desktop/derived-image/README.md) adds the Awai apps and
the DP-1 setting to the pinned PC Live image and is signed with the Awai release key.
It is for development and verification only, not an Awai OS release.

## Choose a route

| Route | Base system | Data | Verified on | Guide |
| --- | --- | --- | --- | --- |
| Emulator, for app development and tests | Google SDK image, API 35 (pinned) | emulator disk | Mac (arm64 AVD) and the Desktop's KVM (x86_64) | [1](#1-emulator) |
| PC LAN Live boot | pinned unofficial PC Live image, Android 17 / API 37 | RAM only, lost on reboot | VM and the physical Desktop, 2026-11-16 | [2](#2-pc-lan-live-boot) |
| PC NVMe persistence | same base, plus ext4 images on NVMe | persists across reboots | the physical Desktop, 2026-11-17 | [3](#3-pc-nvme-persistence) |
| Phone | the device's existing ROM | device storage | test phone (Android 17 / API 37), 2026-11-16 and 17 | [4](#4-phone) |

The PC routes are engineering procedures for **one fixed Desktop** (Ryzen 7
7735HS) connected to an operator Mac by a direct cable. They are not installers
for other PCs.

## Build the Awai apps first

Every route installs the same APKs. Follow [Build](README.md#build) in the
Android README: shared domain tests, ClojureScript build, then
`python3 android/build.py` and `python3 android/build-tests.py`. Outputs and logs
go to `.agent-output/android`. `build.py` never installs on a device.

## 1. Emulator

- **App admission on an x86_64 API 35 VM:** follow
  [Reproduce the app admission and installation](desktop/README.md#reproduce-the-app-admission-and-installation).
  `verify-vm.py` checks the VM identity, API level, ABI and boot state, then
  installs only APKs whose size and SHA-256 match the build report. The SDK
  archives are pinned in [vm-pins.json](desktop/vm-pins.json).
- **Unattended authentication and inference regression on an arm64 API 35 AVD:**
  follow [android/test/README.md](test/README.md). The runner creates a new
  disposable AVD for each run.

The SDK image cannot be installed on a PC disk.

## 2. PC LAN Live boot

Follow [desktop/netboot/README.md](desktop/netboot/README.md). In order:
1. Boot UEFI → DHCP/TFTP → iPXE.
2. Load kernel and initrd over HTTP from the Mac.
3. Read the system image from a read-only NBD export and copy it to RAM.
4. Start Android with tmpfs `/data`.

The init refuses to run if it sees a local disk, so the PC's own disks are never
touched. The exact served artifacts are in
[artifacts-20261116.json](desktop/netboot/artifacts-20261116.json). The base ISO
pin and source limits are in [aosp-architecture.md](desktop/aosp-architecture.md)
and [pc-evaluation-pins.json](desktop/pc-evaluation-pins.json). Verify a candidate
ISO without modifying it:

```sh
python3 android/desktop/verify-pc-image.py /absolute/path/candidate.iso
```

Assembling the initrd overlay is described in prose and is not scripted.

## 3. PC NVMe persistence

Follow the [persistence runbook](desktop/persistence/README.md). It keeps the
Live boot path, but `/data` and `/metadata` live in ext4 image files on the
existing NVMe OS partition. Separate audit, persistent, recovery and repair boot
profiles each check the target, the partitions and the images before Android
starts.

Restoring a checkpoint into the images and assembling the initrd are not
scripted here. Kernel and initrd still come from the Mac. Android file-based
encryption is not available on this base.

## 4. Phone

1. Install the APKs with `adb -s <serial> install`. Always give an explicit
   serial, and keep the existing launcher installed as a rollback.
2. Opt in to Awai Home through Android's default Home app setting; Home is an
   ordinary app.
3. First-run setup runs inside Home: see
   [setup-qualification-20261117.md](setup-qualification-20261117.md).
4. Device qualification so far: [device-qualification-20261116.md](device-qualification-20261116.md).
5. The lock-screen PIN appearance is a resource-only overlay placed through
   Recovery; follow [systemui-pin/README.md](systemui-pin/README.md), including
   its rollback.

The phone keeps its existing ROM. No Awai system image is flashed, and Settings
still shows the base ROM's name. Showing Awai OS there requires the Awai-built,
signed ROM, not relabelling the existing one. The earlier unlock and ROM
bring-up journals are in [archive/android-bringup](../archive/android-bringup).

## What is still missing for an Awai OS image

1. A source-pinned AOSP and device tree build with Awai branding, a signing key
   and a reproducible manifest.
2. An image people can download, with published digests and signature.
3. An installer or flashing procedure for each supported device, with rollback.
4. Signed OTA updates, interrupted-update recovery, and lost-device recovery.
5. File-based encryption and hardware-backed keys on PC, plus an offline (no-Mac) PC boot.

Until these exist, treat every route above as development or engineering
evidence, not as a release.
