# AOSP-centered Awai Android — AWAI-2992

Owner decision, 2026-11-16: AOSP is the platform core. LineageOS is an optional
source of PC hardware enablement, not the identity or required distribution of
Awai OS. Preserve the installed Nix system while qualifying Android in a VM and
then a diskless LAN trial. The physical install target remains undecided.

## Layer boundaries

| Layer | Owns |
| --- | --- |
| Awai experience | Figma-approved Home, Store and Itonami apps; shared `.cljc` domain and existing client-runtime operation consent |
| Android platform | AOSP framework, package lifecycle, SystemUI, Keyguard, permissions, keystore and sandbox |
| PC enablement | x86_64 kernel/modules/firmware, AMD display, Ethernet/Wi-Fi/audio/input, UEFI and live-boot adapter |
| Product release | Complete source manifest, artifact hashes, signing, recovery/update and device qualification |

Share app code and data contracts with the phone edition. Keep desktop layout
adaptations inside that UI; do not introduce a separate launcher design. Use
platform identity/keystore APIs through bounded adapters. Their presence alone
is not proof of wallet persistence, recovery or Awai FS synchronization.

Start with API35+; choose the release branch only after app/device compatibility
and a complete reproducible source manifest are available. A recent branch name
or a pinned device-tree commit is not a complete ROM source pin. Independent
vendor/kernel dependencies, firmware provenance and required patches must be
resolved before a product build is admitted. Do not silently rebrand an
unofficial Lineage image or a commercial Bass image as an Awai ROM.

## Current diagnostic candidate

[PC evaluation pins](pc-evaluation-pins.json) identify an **unofficial third-party
Generic x86_64 Live ISO**, distinct from the final AOSP product build. Each of
its two parts matches the GitHub release's published SHA-256 and byte count.
Observed combined SHA-256:
`63c15c052ff4a9841c680f550c77f1dedaadc6455eca828edd6143f9d5e547e3`.
This verifies downloaded bytes; source closure and production qualification
remain open. No owner account, credentials or physical block device is exposed
to the candidate VM.

On 2026-11-16, the physical 6600H hosted a QEMU 10.2.4/KVM **UEFI** VM with
OVMF, standard VGA, 2 vCPUs, 4608 MiB RAM, user-mode NAT and a read-only virtual
CD-ROM. No virtual hard disk or host filesystem was attached. The guest reported
Android17 / API37 and `sys.boot_completed=1`; `/data` was tmpfs and its only
non-loop disk was `sr0`. The checked v5 Home/Store/Yotei APKs installed, and
Awai Home displayed at 1280×800 after waking the guest. An initial black screen
was confirmed as `mWakefulness=Asleep`, resolved with KEYCODE_WAKEUP; it was not
claimed as an AMD graphics fix. No persistence claim is made for this Live VM.

This is stronger PC boot evidence than the earlier Google SDK VM, but remains
VM evidence. Physical UEFI LAN boot, AMD graphics, real networking/audio and
NVMe installation are **not qualified** by it. The live image's permissive
SELinux/verified-boot-orange settings are diagnostic, not release defaults.

## Next execution gates

1. Serve the pinned system image read-only after the kernel exits UEFI boot
   services. Loading only kernel/ramdisk is insufficient: `generic_init` scans
   block devices for the Android system images. Validate a bounded network
   bootstrap and its disconnect/error behavior in the isolated VM first.
2. Preserve the physical Nix GPT, ESP, root, encrypted state and default boot.
   Make Android trial userdata temporary; exclude installer execution and disk
   writes. Confirm actual AMD display/input/network behavior before selecting
   any persistent installation target.
3. Assemble the Awai AOSP source manifest/build and sign its release separately.
   VM success of the diagnostic image does not complete that work.

Reviewed PC source references (not a full source manifest):

- [Generic device tree](https://github.com/LineageOS/android_device_mainline_generic/tree/3d402dc58aa2086a960abd076204836259387a79)
  provides `liveisoimage` and `ukify_build`.
- [Generic init](https://github.com/LineageOS/android_vendor_mainline/tree/a3baa61e40ab74294ca0063b81155f259c855e6b/services/generic_init)
  handles dynamic system-image discovery and mounts.

The diagnostic ISO's complete source correspondence to these references is
unverified; do not infer it from similar boot parameters.
