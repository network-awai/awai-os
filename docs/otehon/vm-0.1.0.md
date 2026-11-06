# Awai Otehon VM 0.1.0

The first NixOS build of Awai Otehon (`network-awai/network-awai-apex` ADR 0026,
AWAI-160). It proves that the pinned system builds on a Mac without installing
Nix on macOS, and that it boots under QEMU with HVF.

It has no network, login, keys, Hermes Agent, apps or desktop. It is not an
Itonami OS release or a complete Awai Node.

## Build

The Mac has no KVM inside the Podman machine. `image.repart` builds the disk
without a VM. Run this in a checkout of this repository:

```bash
podman volume create awai-otehon-nix
```

```bash
podman run --rm --security-opt label=disable -v awai-otehon-nix:/nix -v "$PWD":/w -w /w --env NIX_CONFIG="sandbox = false" docker.io/nixos/nix@sha256:7a70027ba790d3a79fa82faeac5f3dddc048f89e83b3901ca69542c340c9fb5c nix-build nixos/otehon/default.nix
```

`label=disable` is needed because a later container cannot read store files
that an earlier container created under its own SELinux label.

The result is a raw image inside the volume. Export it compressed, because the
copy is not sparse across the Podman mount. Then convert it on the Mac with
`zstd -d --sparse` and `qemu-img convert -O qcow2 -c`.

## Check

```bash
nixos/otehon/boot-check-qemu.sh otehon.qcow2 serial.log 180
```

Exit codes: `0` report with `failed=0`, `1` failed units or no report, `3` the
check could not run.

## Evidence (2026-11-07, Apple M1 Max, QEMU 10.0.3 with HVF)

| Item | Result |
| --- | --- |
| nixpkgs | `f5c082a40f7571c266e74e80ae2e68aadd8a9fc7` (`ci/nixpkgs.nix`) |
| Build | 252 derivations built, 378 paths fetched (515.94 MiB download) |
| System closure | 1.2 GiB |
| Peak Nix store | 4.2 GiB |
| Raw image SHA-256 | `40ea617b4c0c5b3d7d00496b2bea85fe7513cadc7d00e72074522cdc737f56ca` |
| Boot | `OTEHON_BOOT_REPORT id=awai-otehon-vm version=0.1.0 nixos=26.05pre-git failed=0` after 46 s, exit 0 |
| Negative control | Blank disk: firmware stops at its shell, no report in 40 s, exit 1 |
| Could not run | Missing image: `NOT_RUN`, exit 3 |

The qcow2 differs per conversion, so the raw image hash is the build identity.

## Not verified

- A second independent build reproducing the same hash.
- Writes across a reboot (the check boots with `snapshot=on`).
- x86_64, physical hardware and CI. The repository workflow does not build this
  image.
