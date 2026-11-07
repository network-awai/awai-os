# Awai Otehon operations 0.1.0

How Awai Otehon (ADR 0026 in `network-awai/network-awai-apex`, AWAI-169) is kept working after it
leaves the developer's Mac: how a security fix reaches a device through the signed update path, how
to track CVEs for the pinned nixpkgs, and the steps for a target device. It also records the
repository CI check and the x86_64 support added with it.

Most of the operations path is a plan. Each step says whether it exists. Nothing here touches a
physical disk, publishes an update, or uses a real key.

| Part | State |
| --- | --- |
| Pinned nixpkgs `f5c082a40f7571c266e74e80ae2e68aadd8a9fc7` (`ci/nixpkgs.nix`) | Exists |
| CI evaluates every Otehon profile and runs the shell's tests | Exists (this change). The CI job has not run yet when this was written |
| x86_64 in `common.nix` (`default.nix --argstr arch x86_64`) | Evaluates for the `vm` profile. The system and its UKI build. The disk image does not build on the Mac, and no x86_64 image has booted |
| Signed update with trial boot and rollback (`update.nix`, `update-0.1.0.md`) | Exists, checked in a VM with test keys |
| Publishing an update (real keys, a binary cache, a feed on the network) | Does not exist |
| Fetching updates on a schedule, staged rollout | Does not exist |
| CVE scan of the closure | Does not exist. The procedure below is a plan and was not run |
| Installer that writes a device's disk | Not in this change. PR #45 (6600h netboot) is open and separate |
| A chosen target device | Not decided. AWAI-169 leaves the choice to the owner |

## CI

`.github/workflows/nixos-module.yml` has an `otehon` job. It does not build an image or boot a VM.

1. `npm ci` and `npm test` in `nixos/otehon/shell` (the link and trust tests). The `desktop`
   image runs the same tests in its Nix build, but CI does not build that image.
2. `sh nixos/otehon/eval-profiles.sh .` instantiates the image derivation of every profile with
   `nix-instantiate`: the 17 aarch64 profiles and `vm` for x86_64. Option types, assertions,
   missing files and module errors fail it. It also fails when a `.nix` file in `nixos/otehon` is
   neither a listed profile nor a listed module, so a new profile cannot be left out silently.

Exit codes of `eval-profiles.sh`: `0` every profile evaluated, `1` a profile failed or a file is
not listed, `3` no `nix-instantiate`. Each profile prints `OTEHON_EVAL_OK <profile> <drv>` or
`OTEHON_EVAL_FAIL <profile>` with the end of the error.

There is no JVM, nbb or Babashka in this job. The shell tests run on Node.js (`node --test`). The
owner allowed Node.js in this CI job on 2026-11-07. ADR 0026 D3 does not list it yet.

Run it locally in the Nix container from the repository root:

```bash
podman run --rm --security-opt label=disable -v otehon-shell-nix:/nix -v "$PWD":/w -w /w --env NIX_CONFIG=$'sandbox = false\nfilter-syscalls = false' docker.io/nixos/nix@sha256:7a70027ba790d3a79fa82faeac5f3dddc048f89e83b3901ca69542c340c9fb5c sh nixos/otehon/eval-profiles.sh .
```

## x86_64

`common.nix` sets `nixpkgs.hostPlatform` with `mkDefault "aarch64-linux"`, so aarch64 stays the
default and every aarch64 image derivation is unchanged. `default.nix --argstr arch x86_64` sets
`x86_64-linux`. The serial console is `ttyAMA0` on aarch64 and `ttyS0` on x86. The ESP gets
`BOOTX64.EFI` from `efiArch`. Any other `arch` value stops evaluation with an error.

Only `vm` is evaluated for x86_64. The other profiles were written for the aarch64 VM (`gpu` is for
krunkit on the Mac), and were not tried on x86_64.

Build on the Mac: the Podman machine runs x86_64 binaries through `qemu-x86_64` (binfmt), so add
`extra-platforms = x86_64-linux` to `NIX_CONFIG`. Without it Nix stops with "a 'x86_64-linux' ...
is required to build". Most of the closure comes from `cache.nixos.org`. What is built locally
runs emulated and is slow.

```bash
podman run --rm --security-opt label=disable -v otehon-shell-nix:/nix -v "$PWD":/w -w /w --env NIX_CONFIG=$'sandbox = false\nfilter-syscalls = false\nextra-platforms = x86_64-linux' docker.io/nixos/nix@sha256:7a70027ba790d3a79fa82faeac5f3dddc048f89e83b3901ca69542c340c9fb5c nix-build nixos/otehon/default.nix --argstr arch x86_64
```

This builds the x86_64 system and its UKI, then stops at the disk image: `systemd-repart` runs
under `unshare`, which fails under `qemu-x86_64` with "unshare: unshare failed: Invalid argument".
PR #45 works around this for its own disk with aarch64-native tools. Building the x86_64 image
needs an x86_64 Linux builder (a CI runner or a PC) or that kind of workaround. Neither is in this
change.

Boot check, once an x86_64 image exists, on the Mac under QEMU TCG (no HVF for x86_64):

```bash
OTEHON_ARCH=x86_64 nixos/otehon/boot-check-qemu.sh otehon-x86_64.qcow2 serial.log 1500
```

## Security update flow

The device side of this flow exists (`update-0.1.0.md`). The publishing side does not.

| Step | What happens | State |
| --- | --- | --- |
| 1. Notice | A fix for a package in the closure appears in the nixpkgs tracker or a NixOS advisory (see CVE tracking) | Manual, no schedule |
| 2. Move the pin | Change `ci/nixpkgs.nix` to a newer commit of the `nixos-26.05` channel, with its `sha256` | Manual |
| 3. Evaluate | CI runs `eval-profiles.sh` on the pull request | Exists |
| 4. Build and check | Build the images and run the VM checks: `boot-check-qemu.sh`, `base-check-qemu.sh`, `update-check-qemu.sh`, `desktop-login-check-qemu.sh`. Compare the closure before and after | Exists as local scripts, run by hand. Not in CI |
| 5. Sign | Raise `version`. Sign the closure with the cache key (`nix copy ... ?secret-key=`) and the manifest `{"version": N, "system": "/nix/store/..."}` with the minisign manifest key | Exists only with the test keys in `fixtures/update`, in `update-make-feed.sh`. No real keys, no offline signing |
| 6. Publish | Put the cache and the signed manifest where devices read them | Does not exist. The check uses a read-only directory |
| 7. Apply | On the device, `otehon-update` checks the signature, the version and the cache key, stages a boot entry with one try, and runs the health check | Exists in the `update-check` image. The `desktop` profile does not import `update.nix` yet |
| 8. Confirm or roll back | A healthy trial boot raises the installed version. An unhealthy one falls back and blocks that version | Exists, checked in a VM |

Points that hold for any later design:

- A fix only counts once it is in a signed generation that confirmed on a device. Moving the pin
  in git fixes nothing on a device.
- The version must rise for every release, including a pure security release, because the device
  refuses versions it has already passed.
- The manifest key and the cache key must be kept apart and offline. Key rotation is not designed.
- An update rolls back the system, not data in `/var`. A fix that changes a state format needs its
  own migration and its own check.

## CVE tracking for the pinned nixpkgs

The pin `f5c082a40f7571c266e74e80ae2e68aadd8a9fc7` is a commit on `release-26.05` (2026-09-25,
"[Backport release-26.05] pocket-id: 2.14.0 -> 2.16.0"). On 2026-11-07 the GitHub compare API
showed `nixos-26.05` 3007 commits ahead of it and 0 behind, so the pin is a plain ancestor of the
channel and moving it forward does not drop anything. Security fixes reach `release-26.05` as
backports, and the `nixos-26.05` channel advances once Hydra's tests pass. That makes the channel
head the normal target for step 2.

Planned procedure (none of it has been run or automated):

1. List what is shipped: build `--argstr output system` for each released profile and keep
   `nix-store -qR` of the result with the release.
2. Scan the closure with `vulnix` from the pinned nixpkgs, which matches package names and
   versions against NVD. Keep a whitelist in the repository for entries that were triaged, each
   with a reason and a date. `vulnix` matches by name and version, so expect false positives and
   misses, especially for patched packages.
3. Read the NixOS security tracker and the nixpkgs issues and pull requests labelled
   `1.severity: security` for packages in the closure, and the `release-26.05` backports.
4. Things the closure scan does not cover: the npm packages in `nixos/otehon/shell/package-lock.json`
   (check them with `npm audit` against the lock file), the pinned Kotoba broker in
   `nixos/otehon/shell/vendor/PINS.json`, the model and voice files fetched by hash in `media.nix`
   and `manimani/manimani.nix`, and sops-nix pinned in `base-module.nix`.
5. Record each finding and the decision (move the pin, patch, or accept with a reason) in Linear,
   and link the release that carries the fix.

Advisories already named in ADR 0026 D5, such as the Ollama report, apply only when that package is
in a shipped closure. The current images do not contain Ollama.

## Target device steps

AWAI-169 requires that writing to a real device is approved for each write. The steps below stop
before any write. PR #45 proposes one device (an x86_64 PC with a Ryzen 5 6600H, installed over
netboot) and is reviewed on its own.

1. Owner decision: the device, its architecture, and whether its data may be erased.
2. Check the firmware: UEFI boot, whether Secure Boot is on (Otehon has no Secure Boot signing yet),
   and a serial or screen console to read the boot report.
3. Evaluate and build the image for that architecture (`--argstr arch`), then boot it in QEMU with
   `boot-check-qemu.sh`. On a Mac, x86_64 is emulated.
4. Dry run of the write (design, no code in this change): the installer names the target disk by
   `/dev/disk/by-id`, prints its model, size and current partitions, and prints the partition table
   it would write from the image. It writes nothing. It must refuse a removable or unknown disk, the
   disk it booted from, and a disk smaller than the image, and a check must show each refusal and
   one accepted case. A real write needs the owner's approval for that device.
5. First boot: read `OTEHON_BOOT_REPORT ... failed=0` on the console.
6. Keys: the state volume key (a key disk in `base`, a passphrase in PR #45), the update keys pinned
   in the image, and the device key created in the shell. Real keys do not exist yet.
7. Updates: from here on the device takes only signed generations (the flow above).

## Evidence (2026-11-07, Apple M1 Max, Podman machine aarch64, nixos/nix container)

| Check | Result |
| --- | --- |
| `eval-profiles.sh` on this branch | 17 of 17 `OTEHON_EVAL_OK`, exit 0, about 85 s |
| aarch64 unchanged | The 16 aarch64 image `.drv` paths are identical to those from `origin/main` `4bfe327` (for example `vm` `qzjkbaah2nj7xp6krh6h3hnxzi0ndaxr`) |
| x86_64 `vm` | `.drv` `ca7m4sbnlscyvrkg5cw7vsr5n6jghyjr`. Evaluated config: `system` `x86_64-linux`, `efiArch` `x64`, `console=ttyS0,115200n8` (aarch64: `aa64`, `console=ttyAMA0,115200n8`) |
| Negative: type error | `services.openssh.enable = "yes"` in `vm.nix`: `OTEHON_EVAL_FAIL vm` and `vm@x86_64` with "is not of type `boolean'", the other 15 OK, exit 1 |
| Negative: unlisted file | An extra `vm-extra.nix`: `OTEHON_EVAL_UNLISTED vm-extra.nix`, exit 1 |
| Negative: unknown arch | `--argstr arch riscv64`: "otehon: unknown arch riscv64, expected aarch64 or x86_64" |
| Could not run | No `nix-instantiate` on the Mac: `NOT_RUN`, exit 3 |
| Shell tests | Node 26.0.0: 19 pass, 0 fail, exit 0 |
| Negative: shell tests | `dappMinimum` made to return 0: 18 pass, 1 fail ("minimums apply to the listed operations and to whole dapps"), exit 1. Restored: 19 pass, exit 0 |
| x86_64 build without `extra-platforms` | Refused: "a 'x86_64-linux' with features {} is required to build ... firmware.drv" |
| x86_64 build with `extra-platforms` | `nixos-system-awai-otehon-26.05pre-git` built, UKI built ("Wrote unsigned .../awai-otehon-vm_0.1.0.efi"). The image `awai-otehon-vm-0.1.0.drv` failed: "unshare: unshare failed: Invalid argument", exit 100. Outputs deleted afterwards |
| x86_64 TCG boot | Not run. A disk assembled with aarch64-native tools (GPT, ESP with `systemd-bootx64.efi` and the UKI, ext4 root with `nix-path-registration`) was prepared as a scratch script, not committed. `vm-lock.sh` refused twice: "NOT_RUN only 25385036KiB free, need 30GiB" and "NOT_RUN only 26335308KiB free" |

## Not verified

- The `otehon` CI job on GitHub. It was run locally only, and CI uses Node 22, not 26.
- That an evaluated profile builds or boots. Evaluation does not build, so a build failure or a boot
  failure still passes CI. Building images in CI is not done.
- An x86_64 image and its boot. Only evaluation and the system and UKI build were observed. The
  `boot-check-qemu.sh` x86_64 path (`OTEHON_ARCH=x86_64`, q35, TCG, pflash firmware) has not run
  against an image. The aarch64 path of that script was rearranged and has not been rerun either.
  Only its refusals were run: no image `NOT_RUN` exit 3 for both arches, `OTEHON_ARCH=mips`
  `NOT_RUN` exit 3.
- x86_64 profiles other than `vm`, and any x86_64 hardware.
- Every row marked "does not exist" above: publishing, real keys, a feed on the network, a schedule,
  CVE scanning, and an installer that writes a disk.
