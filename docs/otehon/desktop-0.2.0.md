# Awai Otehon desktop 0.2.0

A GNOME desktop on the pinned NixOS system (`network-awai/network-awai-apex` ADR
0026, AWAI-160). Awai names are shown only for apps whose Otehon is installed.

| Awai name | Otehon |
| --- | --- |
| Itonami Apps | GNOME Software with Flatpak, no remote configured |
| Yotei | GNOME Calendar |
| Tokei | GNOME Clocks |
| Wi-Fi | GNOME Settings Wi-Fi panel |
| Bluetooth | GNOME Settings Bluetooth panel |
| Settei | GNOME Settings |

The user has no password and logs in automatically, so this image is for a local
VM only. It has no SSH, keys or network adapter in the commands below. It is not
an Itonami OS release or a complete Awai Node.

## Build

Follow [vm-0.1.0.md](vm-0.1.0.md) and add `--argstr profile desktop` to
`nix-build`. Refactoring the shared module did not change the store path of
the 0.1.0 image.

## Use

```bash
nixos/otehon/run-desktop-qemu.sh otehon-desktop.qcow2
```

The window writes changes to the image. Use a copy to keep the original.

## Check

```bash
nixos/otehon/desktop-check-qemu.sh otehon-desktop.qcow2 serial.log shot.ppm
```

Exit codes: `0` report with `gnome_shell=1 failed=0` and a saved screenshot, `1`
another state or no report, `3` the check could not run.

## Evidence (2026-11-07, Apple M1 Max, QEMU 10.0.3 with HVF)

| Item | Result |
| --- | --- |
| nixpkgs | `f5c082a40f7571c266e74e80ae2e68aadd8a9fc7` |
| First build | 357 derivations built, 1031 paths fetched (2031.70 MiB download) |
| System closure | 5.2 GiB |
| Raw image SHA-256 | `5835cc95c6926bdb467df7500dbf4de232a94a58405c1930adef2edffd4cbb2e` |
| Boot | `OTEHON_BOOT_REPORT ... gnome_shell=1 failed=0` after about 40 s, exit 0 |
| Screen | The dock shows the six entries above |
| App launch | Searching for `tokei` found Tokei, and Enter opened GNOME Clocks |
| Negative control | The 0.1.0 image has no desktop state: exit 1 |

Keyboard input came from QEMU `sendkey`. The app launch and negative control ran
on the preceding build, which differs only by the removed `Extensions` override.
Boot and screen were rechecked on the final image.

## Known gaps

- `Extensions` still appears in the app grid. A higher-priority `NoDisplay` entry
  did not hide it, so the override was removed.
- Only Tokei was launched. Yotei, Itonami Apps, Wi-Fi, Bluetooth and Settei were
  seen in the dock but not opened.
- Flatpak has no remote, so Itonami Apps cannot install anything yet.
- Writes across a reboot, a person using the window, a reproducing second build,
  x86_64, physical hardware and CI are not verified.
