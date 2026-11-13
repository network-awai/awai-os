# Offline USB installer for Ryzen 5 6600H

AWAI-450 / AWAI-169. This is the Otehon edition, separate from the Native
Murakumo live preview. It carries the current desktop as a compressed disk
payload and boots a text installer. The installer does not start that desktop
from the USB or silently install an internal disk.

Build the immutable ISO with the repository's pinned nixpkgs:

```sh
nix-build nixos/otehon/default.nix --argstr profile usb-install-6600h
nix-build nixos/tests/otehon-usb.nix --out-link result-otehon-usb-check
```

The second command boots the actual ISO as read-only USB in an isolated UEFI
QEMU VM with no network or physical disks. It checks no initial writes, wrong
serial, undersized disk, non-ERASE answer and self-selection refusal. It then
explicitly installs to a newly created scratch target; the existing installer
checks the raw payload digest by reading the full written length. Allocation
maps of the decoy and small disks must remain unchanged. A passing source
evaluation is not a passing build or VM test; inspect the observed result.

The ISO contains `/otehon/image.raw.zst`. Its compressed and uncompressed
digests and raw size are pinned into the installer. No download server is
required. At the PC, enter the exact target disk serial and `ERASE` only if its
listed contents may be destroyed. USB media creation never authorizes choosing
or erasing an internal PC disk.

The installed root is now 24 GiB, replacing the previous 16 GiB layout which
no longer fit the current desktop closure. The state partition grows on first
boot. Choose a passphrase of at least 12 characters and retain it securely;
the existing encrypted-state implementation has no recovery for a lost
passphrase. Chromium profile and user home live in that state volume.

Signed network update modules are available but disabled until explicit
enrollment with production trust/feed/rollout policy. Fixture keys are never
enrolled by this installer. See [network update boundaries](network-update-0.1.0.md).
Secure Boot must be off for this unsigned boot candidate. Physical firmware,
Radeon, Realtek network and installed desktop acceptance remain separate from
the USB/VM evidence.

Before writing physical media, bind the observed ISO hash/length and source
revision to the selected USB's model, serial and capacity. Verify the complete
written length against that hash and eject. Preserve unrelated drives and live
VMs. The current CI uploads the ISO only after its VM check succeeds; use the
matching verification artifact, not a previous release's hash.
