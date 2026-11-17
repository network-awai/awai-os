# Murakumo NixOS network updates

Tracking: JUN-381 (part of JUN-379). This is an operator-controlled OS update
path for an **installed x86_64 UEFI/systemd-boot system**. The v0.1 USB is a
temporary live workspace, so it cannot become a persistent installed OS merely
by receiving this update. Its existing contents are not changed by this work.

The pinned two-VM KVM/OVMF gate passed on 2026-10-24 (750.46 seconds), including
both forced-power-loss cases. [Qualification receipt](evidence/native-network-update-20261024.json)
records the exact implementation revision, 17 source hashes and outcomes.
Physical rollout remains unqualified and disabled by default.

The native profile imports the module but leaves it disabled. It does not import
the historical Node.js/SCI signed updater. Nix, systemd, OpenSSH and a packaged
shell administration tool manage the OS; this is not a claim that these platform
tools are Amu-native. The monitor remains Amu-native and the app remains static
delivery plus browser/Worker execution. There is no new app API, browser remote
root operation or public management listener.

## Provision once on the installed host

Include the reviewed disk/hardware configuration and the native product profile.
The host's existing SSH policy must authorize the operator separately. The update
module creates no SSH keys, sudo rule, root login grant or firewall opening.
Keep the complete pinned repository tree when vendoring this profile: its native
package, desktop assets and update script use repository-relative paths. Copying
only the entry `.nix` file is insufficient.

```nix
{
  imports = [ ./hardware-configuration.nix ./murakumo-nixos.nix ];
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
  services.murakumoNative.networkUpdates = {
    enable = true;
    hostId = "my-murakumo-node"; # stable, unique host configuration contract
    confirmationSeconds = 300;
  };
}
```

Provision the operator's public key using the host's reviewed OpenSSH
configuration, retain password authentication restrictions, and independently
verify/pin the host key in the operator's `known_hosts`. A fresh password prompt
or a changed host key never gets silently accepted. The current CLI requires
already-authorized root SSH; deployments using an unprivileged administration
account need a separately reviewed bounded privilege adapter. No adapter is
invented by the client.

The current device and candidate must have identical update contracts (host ID,
architecture, state version, ESP, required services and trial policy). Upgrade
the protocol/policy through a separately reviewed migration rather than silently
dropping recovery from a release. Channel auto-upgrade cannot run concurrently.
No fleet drain/lease is claimed: do not use this standalone path for an active
fleet worker before the coordinator and job-drain gates are connected.

## Build, stage and update over SSH

Build the **target host's complete NixOS configuration**, not `native-iso.nix`,
using the pinned nixpkgs and source revisions on a trusted build machine. Review
the release and its VM evidence. Keep the exact resulting `/nix/store/...-nixos-system-...`
path. The receiving device never evaluates downloaded Nix source or runs a shell
command supplied by a release announcement.

With Nix, OpenSSH, Bash and jq available on the operator's machine:

```console
archive/nixos/scripts/murakumo-network-update root@MY_SSH_ALIAS /nix/store/HASH-nixos-system-MY_HOST-VERSION --stage-only
archive/nixos/scripts/murakumo-network-update root@MY_SSH_ALIAS /nix/store/HASH-nixos-system-MY_HOST-VERSION
```

The first command only copies missing closure objects. Interrupted transfers
leave the running/default generation alone; rerunning copies missing objects.
This is retry by Nix store object, not byte-range resume of a partial large NAR.
The second command does the same transfer, binds activation to the sender's
exact NAR hash, requests a trial, reconnects with the same pinned host key, and
confirms only after measured local health. The operator must keep the client
running through the trial. If the client is lost, no confirmation is sent.

The SSH route authenticates an already-authorized OS operator and trusted build
source. This is **not** an unattended signed public-release subscription,
publisher quorum or key-rotation protocol. Arbitrary mirrors do not gain update
authority. It does not disable Nix signature verification or accept unknown SSH
keys to make a transfer work.

## Transaction and recovery

1. Refuse a missing/wrong system path, NAR hash, incompatible host contract,
   incomplete/corrupt current or candidate closure, existing one-shot trial,
   inactive recovery timer, concurrent operation or inadequate OS state/ESP space.
2. Pin both closures as GC roots and atomically persist/fsync a private journal.
   Prepare content-addressed kernel/initrd files and a retained old entry. The
   old generation remains the persistent default. Never partition/format a disk.
3. Arm only the candidate as a UEFI **one-shot** entry, then reboot. A power
   cycle after that attempt selects the retained old default. Preparation never
   sets the candidate as the persistent default.
4. The on-device systemd guard survives client/network loss. It measures deadlines
   with boot ID and monotonic uptime, not wall time/NTP. It checks the configured
   local services, loopback static delivery and fresh native observation from the
   current monitor invocation. External Internet/API availability is not a local
   health requirement. Losing the managing connection still withholds commit.
5. After a continuously healthy interval, the returning authorized operator
   confirms the **exact trial ID** over SSH. Only then update the system profile
   and persistent default to the generation that actually booted. A stale ID or
   late confirmation is refused.
6. Bad local health or missing confirmation restores the retained profile/default
   and reboots. Interrupted preparation/commit and a second boot reconcile
   conservatively. Keep a receipt and block the last failed candidate from
   implicit retry; a root operator may explicitly request `--retry-failed` after
   reviewing the cause.

Read status or request a specific pending rollback through the same trusted SSH
route:

```console
ssh MY_SSH_ALIAS murakumo-os-update status
ssh MY_SSH_ALIAS murakumo-os-update rollback TRIAL_UUID
```

The journal and receipts are under `/var/lib/murakumo-os-update` (root-only).
They contain generation paths, hashes, phase, boot IDs and reasons, not SSH keys,
Wi-Fi secrets or user app state. The operation does not erase identity, network
configuration or browser storage. The reviewed candidate still has normal OS
administrator power during boot; build-source trust cannot be replaced by a
host-name field or a successful health check.

OS rollback does not reverse an application's data-schema or Chromium profile
migration. Keep a validated recovery copy before such releases and qualify their
backward compatibility separately. Fixture-file preservation in the OS gate is
not proof that every future application migration is reversible.

Previous closures and custom fallback entries are retained; the updater performs
no generation GC or ESP cleanup. Review receipts and storage before explicitly
retiring old recovery generations. Do not concurrently run another rebuild,
bootloader installer or update authority that can replace the default entry.

## Qualification boundaries

The KVM gate is `archive/nixos/tests/network-update.nix`. It uses an actual OVMF boot
loader and independent on-disk Nix store for the target, then transfers over SSH
from a second VM. It checks host-key refusal, truncated import, staging without
activation, wrong hash/host, low state-filesystem space, serialization, confirmed boot and reboot persistence,
local-health rollback, managing-network loss plus wall-clock rollback, trial
power cycle, interrupted preparation, and preservation of fixture user/network
state and machine identity. Test-generated SSH keys remain private test fixtures.

```console
nix-build archive/nixos/network-update-build.nix --no-out-link
nix-build archive/nixos/tests/network-update.nix --no-out-link
```

VM evidence is not physical qualification. Early kernel/firmware hangs before
the guard starts cannot be rebooted by a userspace timer: a qualified hardware
watchdog or a manual power cycle is still required. The retained one-shot/default
arrangement makes the next boot return to the old generation; it does not promise
an unattended reboot from every hardware failure. No such watchdog is enabled
or asserted by this module.

BIOS/GRUB, Secure Boot/signed UKIs, extra/secret initrds and arbitrary boot-spec
extensions are refused or outside this adapter's qualification. Encrypted-root
and physical firmware/GPU/power-loss recovery require their own gates. Fleet
leases, native Cell execution, distributed app-state recovery, automatic release
signing/distribution, browser policy editing and production rollout remain
separate workstreams. Never enable the legacy updater as a native fallback.

Primary semantics: [NixOS generations and test/boot](https://nixos.org/manual/nixos/stable/index.html#sec-changing-config),
[Nix copy](https://nix.dev/manual/nix/2.28/command-ref/new-cli/nix3-copy.html),
[systemd bootctl one-shot and persistent defaults](https://www.freedesktop.org/software/systemd/man/258/bootctl.html).
