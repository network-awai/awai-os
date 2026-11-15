# Awai Otehon install over PXE 0.1.0

Puts the desktop and the base on an x86_64 PC's own disk, from another machine on a direct cable
(AWAI-169). It erases the disk that the person at the PC names. There is no unattended path.

| Profile | What it is |
| --- | --- |
| `netboot-install-6600h.nix` | The installer. It runs from RAM, and its only login is the prompt below |
| `disk-6600h.nix` | The image it writes: desktop, base and fallback EFI path, about 18.5 GB before compression |
| `netboot-6600h.nix` | The desktop in RAM, with no installer. It writes nothing |
| `hardware-6600h.nix` | What those share for the Ryzen 5 6600H PC |

`nix-build nixos/otehon/default.nix --argstr profile netboot-install-6600h` gives `ipxe.efi`, `kernel`,
`initrd`, `image.raw.zst` and `image.sha256`.

## What the installer does

1. It lists each disk with its model, size and serial, and each partition's size, file system and labels.
2. Someone types the target's serial, then `ERASE`. Anything else writes nothing, and it never picks a
   disk by itself, even when there is only one.
3. It refuses a disk that no single serial identifies, a disk smaller than the image, and a disk in use.
4. It fetches the image into memory and checks the digest built into the installer. A wrong digest writes
   nothing.
5. It writes the image, reads it back and compares that with the digest of the uncompressed image.

The installer runs on the screen and on the serial port, and a lock stops both writing together. The serial
port is how the emulator check drives this same build.

## First boot

The PC has no key disk, so `disk-6600h.nix` replaces the base's unlock step:

- The state partition grows to the rest of the disk.
- The person chooses a passphrase of 12 characters or more, and enters it on each later boot.
- The state volume holds a new age key and the user's home, so Chromium's profile, with the device key and
  the sign-in, is encrypted.

**There is no recovery.** Losing the passphrase loses the data in the state volume.

## Limits

- **Physical access:** after the passphrase, the desktop logs in by itself and the OS sign-in is its only
  gate. The system on the root partition is not encrypted, and it holds only public files.
- **Secure Boot:** the boot files are unsigned, so Secure Boot must be off.
- **Updates:** signed update modules are imported by the desktop but disabled until explicit enrollment.
- **Root partition:** the current source uses a fixed 24 GiB root; the November 7 evidence below used 16 GiB.
- **Build:** `systemd-repart` cannot run under the x86 emulator on the build machine, so this image is
  assembled with `sgdisk`, `mkfs.vfat` and `mke2fs`, not `image.repart`. A native x86_64 builder could
  go back to it.

## Check

`install-check-qemu.py` runs the real path under the emulator, with scratch disks, and reads their allocation
from outside the guest. It checks a wrong serial, a small disk, an answer other than `ERASE` and a changed
image, each writing nothing. Then it checks a good install leaving the other disks untouched, and boots
the written disk: partition growth, a short passphrase, a wrong passphrase, and two boots of the desktop.
Status lines go to the screen, so the serial port shows only prompts. A person reads the desktop's
screenshots in the work directory.

```bash
python3 nixos/otehon/install-check-qemu.py <dir with the build output> <work dir>
```

On 2026-11-07 it passed on the build with image digest `4197fbe960dc3d48`. A 60 GB disk's state partition
grew to 46 GB, and the desktop reached Hello on both boots, read from screenshots. A sign-in surviving a
reboot was not checked. The emulator does not exercise the Radeon 660M, the Realtek network chip,
the PC's firmware, or a real disk.
