# NixOS desktop route deprecation

Owner decision, 2026-11-17: existing Nix may be cleaned up; the Nix route is
deprecated. This supersedes the earlier requirement to keep the desktop Nix OS
indefinitely. Android AOSP remains the Awai OS product route. Authentication,
keys and profiles must survive. Tracking: AWAI-3007 (policy), AWAI-3030 (physical
app acceptance/cleanup), AWAI-2992 (Android persistence).

## Scope

Do not offer the historical NixOS installer as the current Awai OS installation
path. Retain source and dated qualification records as history. The shared UI
source currently lives under `otehon/shell`; Android still packages that
exact shared UI. The directory name does not make Android depend on a running
NixOS. Existing build hosts, node fleets and Native qualification are separate.

## 6600H data boundary observed at handoff

- Current Android boots through the Mac's direct-LAN persistent-v6 profile;
  source98831aa, PC image/API37, not a qualified signed custom AOSP ROM.
- Outer NVMe p2 ext4, UUID9476f840-c703-4d5b-af77-41ea3c7986fb, contains both
  old Nix files and active `/awai-android-2992` images. Android mounts it at
  `/mnt/vendor/generic_init/android`; userdata and metadata are writable loop
  devices backed by that directory. Never format p2 or remove this directory.
- At inventory the old `nix` directory uses about11GB; Android images about9GB.
  These are observations, not a guaranteed reclaimed amount.
- p3 LUKS, ESP, GPT, retained encrypted checkpoint and Keychain custody remain
  separate protected resources. Authentication preservation is not waived.
- The persistent-v6 LAN server and its worktree/artifacts are required by the
  current boot route. Keep them available during reboot tests. Offline EFI
  installation is not established by successful LAN reboot.

## Cleanup procedure

1. Acquire exclusive physical-device handoff. Confirm MAC/ABI, current mounts
   and image backing paths. Inventory old Nix files and active file/process refs.
2. Preserve the existing app APK and encrypt its state **on the device** before
   export. Verify ciphertext digest and authenticated archive structure; no
   plaintext keys/profile/archive may be exported or logged.
3. Encrypt the retired Nix/config archive before export and verify it. This is
   file-preservation evidence, not a claim of a tested Nix OS restore.
4. If there are no active references, rename only the identified Nix directory
   within the same filesystem as a reversible quarantine. Do not change GPT,
   ESP, p3, Android images, provisioning/PIN settings or other apps' identities.
5. Test the updated Android apps, abrupt app stop, actual OS reboot and retained
   identity/data while the Nix path is unavailable. Keep the live LAN boot server.
6. Delete only the verified quarantined Nix directory after acceptance. Measure
   actual space change; keep auth-bearing config/home data and encrypted backup.
   An archive failure, active reference, identity mismatch or failed Android
   reboot is a hold, not authorization to widen the deletion scope.

Record actual checkpoints, artifact pins, preserved resources and reclaimed
bytes in AWAI-3030 and its evidence. This runbook is not evidence that cleanup
or physical app acceptance has already completed. The old ESP/boot files and
recovery guards need a separately witnessed change if later retired; do not edit
pinned recovery witnesses merely to make a check pass.
