# Awai Android Desktop — AWAI-2992

An Android-first desktop experiment, sharing the existing Awai Home, Itonami
Store, Yotei UI and `.cljc` domain. It does not replace the existing Nix image.
The owner selected **VM/LAN qualification first; physical install target later**.

## Design before implementation

[Desktop Home proposal](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=225-94)
reuses Android native UX v2, its wallpaper, type and components. At wide widths,
clock/agenda and shortcuts occupy two columns; the dock/search stay below.
At phone widths, the existing layout stays intact. Standard buttons, Tab focus
and semantic DOM order remain; no spatial reorder or second launcher shell.
The proposal includes an Itonami shortcut from the design inventory. This build
exposes only actually implemented shortcuts (Store, Yotei, Settings, Apps).
SystemUI, Keyguard and the default Android launcher remain installed.

## What was qualified on 2026-11-16

- Google Android 15/API 35 x86_64 VM on the physical Ryzen 6600H's KVM.
- Android Emulator 37.2.13, software graphics, 1440 × 900, 3072 MiB guest RAM.
- Mac connects through authenticated SSH over the direct LAN; ADB is relayed to
  Mac loopback only. This is remote VM debugging, **not firmware/PXE LAN boot**.
- Home/Store/Yotei development APKs v5 build and install into the admitted VM.
- A pointer/input-driven Yotei form created a test event. After an Android guest
  reboot, API boot completion, the Awai HOME role and Home's event projection
  were read back. No horizontal overflow was observed at 1440 px.
- The device clock initially used UTC; its VM timezone was set to Asia/Tokyo.
- Shared compiled domain tests pass. The admission test rejects physical
  devices, old API levels, ARM-only VMs and incomplete boots.

These are development/debug-signed apps, not a production ROM release. Initial
APK installation used ADB; this does not newly qualify the Store installer flow.
Account/wallet persistence, local inference, generated-media storage, production
updates and physical AMD graphics/network/audio remain separate acceptance work.

## Reproduce the app admission and installation

Use an explicit SDK Android 15+ x86_64 emulator. Do not reuse an owner's profile.
Build with the existing documented SDK prerequisites:

```sh
python3 android/build.py --skip-cljs --version 5
python3 android/desktop/verify-vm.py --adb /absolute/path/to/adb \
  --serial 127.0.0.1:15585
python3 android/desktop/verify-vm.py --adb /absolute/path/to/adb \
  --serial 127.0.0.1:15585 --build-report .agent-output/android/build-v5.json --install
python3 -m unittest discover -s android/desktop -p 'test_*.py'
```

Inspection is read-only by default. Installation first verifies the VM identity,
API, ABI, completed boot and every APK's size/SHA-256. It never partitions a
disk or changes the HOME role. Its report labels physical and LAN boot unverified.
Bind ADB only to a trusted local transport; do not expose port 5555 on the LAN.
The image does not enforce this; see the
[debug route design](../../docs/otehon/android-debug-routes-design-20261121.md) (proposal).

## VM image provenance and runtime adaptation

[vm-pins.json](vm-pins.json) records official immutable SDK archive URLs, sizes,
Google repository XML SHA-1 values and independently calculated SHA-256 values.
Official SHA-1/size checks passed before extraction. The calculated SHA-256 is
an observation, not a separately published upstream SHA-256 attestation.

The temporary NixOS maintenance host cannot run generic Linux ELF files directly.
Only task-local extracted emulator/ADB binaries had their interpreter adjusted
to the installed glibc; bundled Qt libraries and installed Nix libraries were
added to that process's library path. No host linker, OS profile or existing app
binary was changed. This host adaptation is diagnostic, not a portable SDK package.
VM files live in a new dedicated directory on the existing encrypted data
filesystem. Its GPT, ESP, root filesystem and default boot entry are unchanged.

## Direct PC boot and installation: pending

The SDK image targets an emulator and cannot be installed on NVMe as a PC ROM.
Current apps require API 35+. Old Android-x86/Bliss archive images are not an
automatic compatible base. [Bliss OS public images are paused](https://blissos.org/status.html)
and archived releases have no promised upgrade path. Bliss OS 18's Android 15
source (`BlissOS/platform_manifest`, `voyager-x86`, observed top-level commit
`db973c9fec45d90f4b85de56c6711e0227716e69`, default Android tag
`android-15.0.0_r14`) is a candidate to investigate, not
a fully locked source tree, produced ISO or supported 6600H release.

Next: obtain/build a source-locked API35+ PC image, inspect its installer and
UEFI kernel/initrd route, validate VM install/restart, then serve an exact pinned
artifact for physical LAN boot. Refuse any installer plan touching the existing
Nix disk. Real AMD display, input, networking and audio must pass before choosing
an install target. Keep current Nix boot and data until Android is accepted.

## AOSP core and PC Live qualification

The owner selected an [AOSP-centered architecture](aosp-architecture.md).
An independently pinned, unofficial PC Live ISO now boots through UEFI in an
isolated 6600H-hosted VM and reports API37/boot-complete; the checked Awai Home
also displays. This adds PC VM evidence, not physical LAN or product-ROM proof.
Read the architecture note for source provenance, boundaries and remaining work.
Verify a concatenated ISO without modifying it:

```sh
python3 android/desktop/verify-pc-image.py /absolute/path/candidate.iso
```
