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

## Not verified or not implemented

- A system that cannot boot at all, such as a kernel panic. The check uses one that boots and fails
  health. Fallback in that case relies on the same try counter, but has not been run.
- Fetching over a network, a schedule, staged rollout, and a publishing service. Feeds here are a
  read-only directory, and `apply` is run by hand or by the check.
- Key rotation, and keeping the signing key offline.
- A rollback of state: only the system is rolled back, not data in `/var`.
- The `desktop` profile does not import this module yet.
- Secure Boot, x86_64, physical hardware, and a CI image build.
