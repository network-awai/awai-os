# AiueOS update qualification — 2026-10-08

Implemented: independent Ed25519 quorum verification; exact payload and complete
closure SHA256/length; replay/expiry/channel/architecture checks; streaming
file/HTTPS delivery; complete Nix import and store-path verification; offline
Kotoba policy runtime; root provisioning; flock/CAS/fsync journal; conditional
Nix timer/recovery services; UEFI one-shot trial/fallback; local health commit,
rollback and failed-release blocking; redacted Node status.

## Observed tests

- Shared grant lifecycle: 4 tests / 36 assertions, no failures.
- Final installer source on macOS: 83 tests passed, no skips or failures.
- Final installer source on Linux Node 22: 82 passed, 1 skipped (the separate
  cross-checkout kbb bridge is absent), no failures. Packaged offline SCI policy
  is tested on both platforms; Mac also executes the actual cross-repo kbb port.
- Offline Nix builds of three minimal x86_64 QA generations completed. These
  exercise the real updater module; they are not the graphical installer ISO.
  The final guard/recovery unit revision also builds offline as
  `/nix/store/dj86p6wzzpd2xln3yb69nmpqx19jq3d1-nixos-system-aiueos-update-qa-26.05pre-git`;
  that final rebuilt generation has not had another full trial boot.

## Actual same-disk VM flow

Dedicated disposable 16 GiB disk, QEMU TCG x86_64, OVMF UEFI, i6300esb watchdog,
**no NIC**. The updater reads signed complete closures through a local 9p mirror;
signature private keys are outside that mount and only public roots are on Node.
Two independent QA signatures are required. QA roots are not production roots.

1. Owner-provisioned baseline sequence 1. Only the automatic timer was started;
   no manual updater command or manual reboot triggered the normal update.
2. Low-security-risk sequence 2 staged, trial-booted and committed after local
   NetworkManager/required-service health. Journal records highestSequence=2,
   highestAdmittedSequence=2, pending=null, outcome=committed.
3. Changed owner policy to manual and source to critical sequence 3. QA grace was
   zero to accelerate the deadline; no applyNow or explicit apply consent was
   supplied. The timer verified/staged, persisted refusal of new work, then
   trial-booted after the deadline.
4. Sequence 3 deliberately fails a required local service. Recovery timed out,
   blocked its manifest, restored the previous default, rebooted and returned
   to sequence 2 on the same disk. Journal retains admitted high-water 3,
   installed sequence 2, pending=null, outcome=rolled-back. The admission gate
   remains restricted because the critical release has not safely installed.
5. Ran the final Linux provider against a deliberately unreadable configuration
   and a journal whose retained previous generation was already running. It
   cleared pending and blocked the fixture without another reboot.
6. Wrote/fsynced a fixture at the early trial-prepared journal phase, before full
   boot context is present, then issued a QEMU hard reset. On boot, recovery
   kept the healthy generation and recorded preparation-interrupted. This is
   a journal-phase fault fixture, not an exhaustive cut at every ESP write.
7. Device private-key and NetworkManager fixture-profile SHA256 values match
   baseline after update, rollback and reset. No real Wi-Fi password was used.

For the ordinary window test, a transient service TZ selects an eligible local
03:00–05:00 window. QA timer intervals are accelerated to 2 seconds. Production
interval remains 15 minutes plus jitter; high/critical grace remains 72/24 hours.
The baseline and published good/bad closures precede the final extra `.drv`
refusal and unreadable-config recovery guard. Final source tests cover the guard;
the unreadable-config VM test explicitly executes that final source. Exact
published paths/hashes and resulting journals are in [evidence](evidence/updates-20261008/releases.json).

## Remaining production gates

This provider supports standalone UEFI Nodes. Fleet role refuses until actual
coordinator leases, measured drain and scheduler admission consumption are
integrated. Remote account-authenticated policy UI and production distribution,
DNS/TLS/signing authority/promotion are not provisioned. Production roots must
never be substituted with QA roots.

Physical 6600HS watchdog/fallback, BIOS hosts, a pre-kernel hang, all ESP/power-loss
cut points, real disk-full recovery and fleet continuity are not qualified by
these observations. There is no automatic old-generation/archive GC. No
physical Node, USB, production deployment, real phone ceremony or account was
modified. Task-owned QA VMs are shut down after recording evidence.

## Reproduction

See [operations](update-operations.md) for build/publish/cosign/provision commands.
Run `node --test test/*.test.mjs`; set `AIUEOS_GRANT_CHECKOUT` to the matching grant
checkout to qualify the cross-checkout bridge. Without it the bridge explicitly
skips. Tests do not replace physical watchdog or fleet qualification.
