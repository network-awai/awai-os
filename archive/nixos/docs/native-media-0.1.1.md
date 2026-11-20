# Murakumo NixOS 0.1.1 live media candidate

Tracking: JUN-36 / JUN-379. Network update implementation: JUN-381, merged
at `2039e4522a9011bbc9317ea3ad42e72c1e898270`.

This image adds the installed-host network update tools and instructions to
the native live workspace. It remains a temporary preview: no automatic disk
installation, configured live-OS update authority, release subscription or
remote-administration key is added.

- Operator command: `murakumo-network-update`.
- Installed-host command: `murakumo-os-update`. On the live ISO it refuses
  operations with `network updates are not configured` before creating state.
- Installed-profile source bundle: `/etc/murakumo/native-profile`. Its
  `media-manifest.json` records 24 explicitly selected file hashes. It excludes
  Git metadata, arbitrary checkout files, keys and host disk configuration.
- Provisioning and update guide: `/etc/murakumo/network-update-guide.md`.

The source bundle preserves imports for the installed native profile and update
helper. It is not an offline installed-system closure or a complete release
checkout. Build the target's reviewed complete configuration and provision its
SSH trust separately, as described in [the update guide](native-network-updates.md).
This ISO does not perform those operations for the user.

## Exact ISO and VM verification

[Machine-readable qualification receipt](../../../docs/evidence/native-media-20261024.json).

- Filename: `murakumo-nixos-0.1.1-x86_64-linux.iso`
- Length: `2220474368` bytes
- SHA-256: `d901449166b191504ea3ecc9a3a4b353816b7cb1db65ba653538dd5627d5637e`
- Pinned nixpkgs: `f5c082a40f7571c266e74e80ae2e68aadd8a9fc7`
- ISO derivation output:
  `/nix/store/8fcf902pp8czhnmq2z6ayj334hwbw9pl-murakumo-nixos-0.1.1-x86_64-linux.iso`

The actual ISO was booted with KVM/OVMF, 4 GiB RAM, two virtual CPUs, a virtual
GPU and a new 64 MiB sentinel disk. There was no physical disk, host directory
share, incoming port forwarding or external network access. The gate verified:

- Native monitor, static loopback server and Cage/Chromium are running.
- Browser/Worker initialization reaches `Local runtime ready` (screen OCR).
- All 24 bundle hashes match; the 17 source hashes from the previous full
  [network-update qualification](../../../docs/evidence/native-network-update-20261024.json)
  also match the ISO's files.
- No live update contract, recovery timer, automatic install service or app-origin
  update/status API exists. The helper refuses live updates without state writes.
- The operator CLI's usage refusal works; no Node.js, JVM or nbb process runs.
- The entire sentinel disk's SHA-256 is unchanged; the task VM is stopped.

Reproduce the ISO gate on an unprivileged Linux KVM builder with QEMU, OVMF
and a Tesseract installation containing English language data:

```console
nix-build archive/nixos/native-build.nix -A iso --no-out-link
python3 archive/nixos/scripts/check-native-iso-vm.py --iso /path/to/the.iso \
  --output /path/to/new-vm-output --tesseract /path/to/tesseract
```

`--output` must not exist. The gate creates its own writable disk and firmware
variables there; it never accepts a target block device. It saves the console,
screen, OCR and `proof.json` even on a failed check. The default OVMF paths suit
Ubuntu; pass `--ovmf-code` and `--ovmf-vars` for other distributions.

This gate checks the media. The earlier two-VM network gate checks installed-OS
SSH transfer, one-shot trials, confirmation and rollback; it was not rerun merely
for media packaging because its qualified source hashes are unchanged. Neither
gate qualifies physical firmware, GPU, installation or early-kernel recovery.
USB writing and whole-image readback are a separate pending operation, after the
owner reconnects the same approved KIOXIA. No physical host was installed.
