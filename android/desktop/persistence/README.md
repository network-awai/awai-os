# Android Desktop NVMe persistence — operator runbook (AWAI-2992 / AWAI-3032)

This runbook keeps Android's `/data` and `/metadata` on the NVMe of **one fixed
engineering Desktop** (Ryzen 7 7735HS, previously labelled "6600H"). It extends
the [LAN Live boot](../netboot/README.md): kernel and initrd still come over the
direct LAN, system and firmware images are copied to RAM, and userdata,
metadata and cache are ext4 image files on the existing NVMe OS partition.

It is **not an installer** and does not apply to any other machine. Every script
pins this target's NIC address, NVMe capacity, partition UUIDs, image UUIDs and
system-image digests, and refuses to run if any of them differ. Reusing it on
another device means new pins and a new review. The base system image is the
pinned, unofficial PC Live candidate in
[`../pc-evaluation-pins.json`](../pc-evaluation-pins.json), not an Awai-built ROM.

## What is on the disk

| Item | Location | Protection |
| --- | --- | --- |
| ESP (`nvme0n1p1`) | unchanged | read-only during every boot profile |
| Existing OS filesystem (`nvme0n1p2`, ext4) | holds `/awai-android-2992/` | read-only, except the persistent profile and the explicit repair flags |
| Encrypted state (`nvme0n1p3`, LUKS) | unchanged | read-only during every boot profile |
| `/awai-android-2992/{system,system_dlkm,vendor,vendor_dlkm,firmware}.img` | copies of the Live images, digest-checked | verified before each boot |
| `/awai-android-2992/{userdata,metadata,cache}.img` | ext4 images: 6 GiB, 64 MiB, 128 MiB, 4 KiB blocks | UUID and size checked before each boot |
| `/awai-android-2992/restore-complete.v1` | marker naming the restored checkpoint | boot refuses unless it matches the pinned text |

The old NixOS route's cleanup must keep `nvme0n1p2` and `/awai-android-2992/`.
Removing old Nix files there is fine; reformatting the partition is not. See the
[deprecation boundary](../../../docs/otehon/nixos-route-deprecation-20261117.md).

## Network and ports

The operator Mac and the Desktop share a direct cable: the Mac is `10.77.0.1`,
the Desktop is `10.77.0.2`.

| Port | Where | Purpose |
| --- | --- | --- |
| 18091 | Mac | `serve-artifacts.mjs`: kernel, initrd, `ipxe.efi` for these profiles (static, digest-checked) |
| 10829 | Mac | read-only NBD export `awai2992`, used by the audit profile only |
| 18095 | Mac | `collect-boot-log.mjs`: bounded kernel log stream from the Desktop |
| 18092 | Desktop | early-boot status page (`http://10.77.0.2:18092/`) until hand-off to Android |
| 5555 | Desktop | ADB, used by the host-side scripts with the serial `10.77.0.2:5555` |

## Boot profiles

`patch-ipxe.mjs` derives each profile's `ipxe.efi` from the pinned, unsigned
engineering iPXE binary. Build each profile's initrd the way the
[netboot README](../netboot/README.md) describes, but use the profile's init
script as the overlay init instead of `netboot/init.sh`.

| Profile | Init script | `/data` | NVMe writes |
| --- | --- | --- | --- |
| `audit` | `init-audit.sh` | tmpfs, system from read-only NBD | none; the namespace and every partition are set read-only |
| `persistent` | `init-persistent.sh` | `userdata.img` on NVMe | OS partition only, after every guard passes |
| `recovery` | `init-recovery.sh` | tmpfs | none |
| `repair` | `init-recovery.sh` + `awai.os_journal_repair=1` | tmpfs | replays the OS partition's ext4 journal, then returns to read-only |
| `reblock` | `init-recovery.sh` + both repair flags | tmpfs | also migrates 1 KiB metadata/cache images to the pinned 4 KiB templates, keeping the originals |

Before handing off to Android, the persistent and recovery inits check, in
order: the target NIC, the boot mode on the kernel command line, a single NVMe
namespace of the pinned size, the root and LUKS UUIDs, that no other local disk
is visible, and `verify-images.sh` (restore marker, image UUIDs/sizes, system
digests, and 4 KiB blocks for `persistent`). Any failure stops at a shell and
shows `REFUSED <reason>` on the console and the status page.

The overlay's `/awai/` holds these files:
- static BusyBox
- the NIC modules and `rtl_nic` firmware from the netboot README
- the `nvme-keyring`, `nvme-auth`, `nvme-core` and `nvme` modules
- `readonly-nvme.sh`, `verify-images.sh` and `stream-boot-log.sh`
- for recovery: also `repair-os-journal.sh`, `replay-root-journal.sh`, `repair-small-images.sh`, `migrate-small-images.sh` and `templates/` (from `prepare-small-image-templates.mjs`)

The ext4 modules come from the original ramdisk's `/lib/modules`.

## Procedure as performed on 2026-11-17

Run the host-side scripts with Node from the repository root. Each writes a new
JSON record and refuses to overwrite an existing one.

1. **Encrypted checkpoint of the current RAM-Live data.**
   `node android/desktop/persistence/capture-device.mjs 10.77.0.2:5555 <keychain-helper> <new-dir>`
   stops the framework, tars `/data` and `/metadata` and encrypts the archive with
   `age` on the device. It then pulls it and checks the digest and authenticated
   decryption through the Keychain helper. Keys and archives are never committed.
2. **Protected-region witness.**
   `node android/desktop/persistence/disk-witness.mjs <before.json>` records
   digests of the GPT head and tail, the ESP and the LUKS header.
   Repeat with `<after.json> <before.json>` after any later step to prove they did not change.
3. **Read-only audit boot** (`audit` profile) to confirm the NVMe layout without writes.
4. **Create the image files** by running `create-images.sh` as root on the Desktop,
   inside a Live session where the OS partition is mounted read-only at
   `/mnt/awai-2992-root-audit`. It only creates new regular files; it never
   formats a block device and refuses if `/awai-android-2992` already exists.
5. **Restore the checkpoint into the new images.** *Not scripted in this
   repository*: the restore used a one-time rewrap with private keys. Check
   the staged result with
   `node android/desktop/persistence/verify-staged.mjs <state-before.json> <out.json>`
   (peer markers and encrypted-file digests only). The restore also writes the
   `restore-complete.v1` marker naming the checkpoint; `verify-images.sh`
   refuses to boot unless it matches the pinned text exactly.
6. **Build and serve the artifacts.**
   - Patch iPXE: `node android/desktop/persistence/patch-ipxe.mjs <ipxe.efi> persistent <out.efi>`.
   - Assemble the initrd as described above. `extract-initrd-input.mjs <initrd> <name> <sha256> <out>`
     copies exactly one digest-pinned file out of an existing initrd.
   - Serve: `node android/desktop/persistence/serve-artifacts.mjs <dir> <manifest.json>`
     (the manifest's `files` object gives `bytes` and `sha256` for each file).
   - Firmware route: `activate-route.mjs <plan.json> <record.json>` moves the
     operator's boot-directory symlink to the new directory, keeping the old one.
     `switch-route.mjs <record.json> <new-dir> <pins.json> <out.json>` changes
     it again later.
   - *Not scripted here:* assembling the initrd overlay.
7. **Boot `persistent`.** Before powering on, start
   `node android/desktop/persistence/collect-boot-log.mjs <log>`. Watch
   `http://10.77.0.2:18092/` for the boot stage.
8. **Accept.**
   - `state-audit.mjs 10.77.0.2:5555 <first.json>` records the mounts and the
     preview apps' peer identities and WNFS file digests.
   - Reboot, then run `state-audit.mjs 10.77.0.2:5555 <second.json> <first.json>`.
     It requires a new boot ID, persistent ext4 `/data` and `/metadata`, and
     unchanged identities and files.
   - `verify-native-peers.mjs <first.json> <playwright-module> <out.json>`
     checks each app's real native peer identity.
   - Repeat the disk witness against the first record.

## Recovery and rollback

- **Boot without touching persistent data:** use the `recovery` profile. `/data`
  is tmpfs and the NVMe stays read-only. The images are still verified.
- **OS partition journal needs replay** (for example after an unclean power-off):
  boot `repair`. It checks the protected-region digests before and after, syncs,
  and verifies the images again on a clean read-only mount.
- **Old 1 KiB metadata/cache images:** boot `reblock`. The originals stay beside
  the migrated images, and content, ownership, permissions and symlinks are
  compared before the active names are swapped.
- **Go back to RAM Live:** switch the boot route back to the previous artifact
  directory with `switch-route.mjs`, or serve the netboot artifacts. Nothing
  under `/awai-android-2992` is deleted by any profile.
- The encrypted checkpoint from step 1 is the off-device copy. Restoring it is
  the same unscripted step as step 5.

## Verified state and limits

Verified on the physical Desktop on 2026-11-17:
- two persistent boots with changed boot IDs and ext4 `/data` and `/metadata`
- five preview apps keeping their native peer identities
- nine encrypted WNFS files with unchanged digests
- unchanged protected regions
- a successful journal repair and small-image migration

Not done or not qualified:
- Android file-based encryption: this engineering ROM reports encryption unsupported.
- Boot without the Mac: kernel and initrd still come over the direct LAN; there is no offline EFI boot.
- An Awai-built, signed system image, OTA updates and rollback.
- Natural long Doze, NAT across an independent WAN, and full peripheral qualification.
- The tested APKs are preview 0.1.2 (code 1002, source `cfdacb7`); the boot artifacts were built from source `98831aa`.

## Evidence

| Record | Shows |
| --- | --- |
| [checkpoint-20261117.json](evidence/checkpoint-20261117.json) | encrypted `/data` + `/metadata` checkpoint, digest and custody |
| [audit-vm-20261117.json](evidence/audit-vm-20261117.json) | read-only NVMe guard and input-digest refusals in a VM |
| [early-ext4-20261117.json](evidence/early-ext4-20261117.json) | ext4 modules load before Android in a VM |
| [physical-images-20261117.json](evidence/physical-images-20261117.json) | image files created on the Desktop with matching system digests |
| [staged-restore-20261117.json](evidence/staged-restore-20261117.json) | staged restore matches peer markers and encrypted files |
| [full-boot-guard-vm-20261117.json](evidence/full-boot-guard-vm-20261117.json), [boot-status-vm-20261117.json](evidence/boot-status-vm-20261117.json), [boot-log-stream-vm-20261117.json](evidence/boot-log-stream-vm-20261117.json) | boot guards, status page and log stream in a VM |
| [physical-persistence-first-20261117.json](evidence/physical-persistence-first-20261117.json), [physical-persistence-second-20261117.json](evidence/physical-persistence-second-20261117.json) | the two physical persistent boots |
| [physical-recovery-20261117.json](evidence/physical-recovery-20261117.json), [physical-journal-diagnosis-20261117.json](evidence/physical-journal-diagnosis-20261117.json), [journal-replay-vm-20261117.json](evidence/journal-replay-vm-20261117.json), [nvme-recovery-vm-20261117.json](evidence/nvme-recovery-vm-20261117.json) | recovery profile and journal repair |
| [physical-small-image-repair-20261117.json](evidence/physical-small-image-repair-20261117.json), [small-image-reblock-vm-20261117.json](evidence/small-image-reblock-vm-20261117.json) | 1 KiB → 4 KiB migration |

Source: [network-awai/awai-os#163](https://github.com/network-awai/awai-os/pull/163).
