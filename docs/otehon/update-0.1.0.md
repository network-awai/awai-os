# Awai Otehon updates 0.1.0

Signed updates with a trial boot and automatic rollback (AWAI-164). This is the update foundation
for AIUEOS Otehon. It is modelled on A/B updates, but uses NixOS generations.

| Step | What happens |
| --- | --- |
| Check | A minisign signature covers a manifest with a version and a system path. The key is pinned in the image. |
| Fetch | The closure comes from a Nix binary cache. Nix refuses paths that the pinned cache key has not signed. |
| Stage | The new generation gets a boot entry with one try, using systemd-boot boot counting on the ESP. It does not need writable EFI variables. |
| Trial | `otehon-update-health` must pass before `boot-complete.target`. Only then does `systemd-bless-boot` mark the entry good. |
| Confirm | The installed version rises, and older versions are refused from then on. |
| Fall back | With no tries left, systemd-boot chooses the previous generation. That boot removes the failed generation and blocks its version. |

The module is `nixos/otehon/update.nix`, and the command is `nixos/otehon/update.sh`. An image that
imports the module must set `otehon.update.baseVersion`, `publicKey` and `cacheKey`.

`nixos/otehon/fixtures/update` holds test keys for local check VMs. They sign nothing else.

## Keys on the desktop

The `desktop` profile imports the module and sets no keys, so it does not build alone. The builder
writes a module outside this repository and passes its absolute path:

```nix
{ otehon.update = { baseVersion = 1; publicKey = ./manifest.pub; cacheKey = ./cache.pub; }; }
```

```bash
nix-build nixos/otehon/default.nix --argstr profile desktop --argstr extraModule /abs/path/keys.nix
```

Only public keys enter the image. Check images import `update-test-keys.nix`, which sets
`allowTestKeys`. Any other image that names a fixture key fails to evaluate.

## Feed schedule

`otehon.update.feed` is null by default, and then there is no timer. Set it to a local directory,
such as a mounted medium, and a timer runs `otehon-update apply` on it on `feedSchedule` (default
daily). It does three things and no more:

- It reads a directory. It fetches nothing over a network: a network feed needs its own approved
  operation, which does not exist yet.
- It stages. The trial starts at the next reboot, which it does not cause.
- A refusal, such as `old-version` when nothing is new, exits 2 and is logged as a normal result.

## Readiness and health on the desktop

`otehon-update ready` prints `READY` or `NOT_READY <reason>`. It checks that the keys are present, the
running system is in the Nix database, the ESP is mounted writable, and the health and settle
units are active. It says nothing about any feed. The desktop boot report carries `updater=` and
`update_version=`.

On the desktop, health waits for `graphical.target`. Any failed unit fails health, including a
`nofail` mount with no device, so `otehon-models` is mounted only when `otehon.media.modelShare` is set.

The Updates dapp panel shows `system.image.version`, built into the shell. It does not show the update
number above, and nothing in the panel starts an update.

## Check

Build the `update-check` image, then build the feeds in the Nix container from the repository root:

```bash
sh nixos/otehon/update-make-feed.sh .agent-output/update/feed
```

```bash
nixos/otehon/update-check-qemu.sh image.qcow2 feed serial.log
```

Exit codes: `0` every check passed, `1` a check failed, `3` the check could not run. The image
changes, so run it on a copy.

For the desktop, build the `desktop-update-check` image, then:

```bash
sh nixos/otehon/desktop-update-make-feed.sh .agent-output/dfeed
```

```bash
nixos/otehon/desktop-update-check-qemu.sh image.qcow2 dfeed serial.log
```

The timer stages version 2 and the trial boot confirms it. Version 3 has a failing unit and must roll
back. The desktop must be up on each good boot. `desktop-check` is the boot check with the updater
on it, and `desktop-no-updater` is its negative control.

## Evidence (2026-11-07, Apple M1 Max, QEMU 10.0.3 with HVF)

Raw image `2fb449c05807483d558f49154aa1429cc2ab817089a6dd8087231b221f5381b4`, exit 0, in one QEMU
run across four reboots:

| Case | Result |
| --- | --- |
| A correctly signed manifest | Accepted |
| No signature | `no-signature` |
| Signed by another key | `bad-signature` |
| Changed after signing | `bad-signature` |
| Good manifest, closure signed by another cache key | `bad-closure` |
| Version 2, healthy | Trial boot, `CONFIRMED version=2`, generation b |
| Older signed version | `old-version` |
| Version 3, with a failing unit | `UNHEALTHY`, `TRIAL_FAILED`, reboot, `ROLLED_BACK version=3 installed=2` |
| Version 3 again | `blocked-version` |
| Final state | Generation b, version 2, entries for generations 1 and 2 only |

The accepted case matters. An earlier run refused everything because the key path was wrong, and
looked correct until a good manifest was also tested.

## Evidence on the desktop (2026-11-07, evaluation and one fault, not a passing boot)

Key handling, by `nix-instantiate` in the Nix container. This is evaluation, not a VM check:

| Case | Result |
| --- | --- |
| `desktop`, no keys | Exit 1: `otehon.update.publicKey` has no value |
| `desktop`, fixture manifest key | Exit 1: the test key assertion |
| `desktop`, fixture cache key | Exit 1: the test key assertion |
| `desktop`, throwaway keys through `extraModule` | Exit 0, a system derivation |
| All `desktop-*` and `update-check*` check profiles | Exit 0 |

One boot under QEMU found a fault, on the code before the `modelShare` change. Raw image
`405cf4b0759adfcb4d9baab9d5ad86694c0e00fa68781a98c8033acdfc3b9b30`, exit 1:

```text
otehon-update: UNHEALTHY var-lib-otehon\x2dmodels.mount
otehon-update: NOT_READY unhealthy
OTEHON_BOOT_REPORT ... compositor=1 chromium=1 react=1 zenoh=1 matter=1 gate=1 failed=2 updater=0 update_version=1
```

Every trial on such a desktop would have rolled back. The fix has not been booted. The Mac ran out of
disk before it could be: it reached 116 MiB free during the first build, which also made Podman report
a malformed database, and it stayed between 131 MiB and 19 GiB for three hours after that. A later
build of the fixed image finished (raw `ee4bdb86f4b75048ff9469a02110cbbfcf7daa56eb5b0eec999bc374a3c96945`)
but was aborted at 2.5 GiB free before export, so it was never booted. Its store output alone was
12.8 GB, so allow about 30 GiB free for one desktop image.

## Not verified or not implemented

- **The desktop checks have not passed with this change.** Not run after the fix: `desktop-check`,
  `desktop-no-updater`, `desktop-no-zenoh`, `desktop-login` with the Updates panel step,
  `desktop-media-gui` and `desktop-update-check`. `desktop-media` under krunkit, which turns
  `modelShare` on, has been evaluated but not run. The desktop update path, the feed timer and
  `otehon-update ready` returning `READY` have not been observed.
- **The update check has not been run again** after this change to `update.nix` and `update.sh`. The
  evidence above is from before it, and it no longer describes this code.

- A system that cannot boot at all, such as a kernel panic. The check uses one that boots and fails
  health. Fallback in that case relies on the same try counter, but has not been run.
- Fetching over a network, staged rollout, and a publishing service. Feeds here are a read-only
  directory.
- Key rotation, and keeping the signing key offline.
- A rollback of state: only the system is rolled back, not data in `/var`.
- Units that fail after health has run do not affect the trial. Health is a check at one moment,
  and a compositor that crashes inside a live greetd session may not show as a failed unit.
- Old generations are not removed, so the ESP (512 MiB) and the 12 GiB root fill after many updates.
- Secure Boot, x86_64, physical hardware, and a CI image build.
