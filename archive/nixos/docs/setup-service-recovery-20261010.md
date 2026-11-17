# Setup update and LAN connection recovery — 2026-10-10

Both reported errors were reproduced in the installed NixOS VM using the actual setup service PATH and `ProtectSystem=strict`.

- Update consent attempted to create a state directory outside the UI service's writable `StateDirectory`. Node reported `ENOENT` from recursive mkdir. The UI service now declares both `murakumo` and `aiueos-update`, with private 0700 permissions.
- The remote service was healthy. Its UI invoked `hostname -I`, but `hostname` was absent from the service PATH; accessing the failed command's stdout threw and became the generic “Remote management unavailable” message. Native network interface discovery now produces deduplicated local IPv4 URLs without that command.
- The update UI starts the declaratively enabled timer instead of trying to mutate NixOS's read-only enablement links. It checks the start result, and saved consent can resume the timer without rewriting the configuration or replay journal.

## Validation

45 focused regression tests passed (update UI, setup flow, remote access, Linux update provider, signed releases, and preserving USB update). The first sandboxed broad test invocation crashed in the local Node runtime; the same selected tests passed under an escalated local test invocation.

The dedicated installed VM was running the previously published sequence-5 closure. Original UI functions failed under its exact PATH and equivalent sandbox. Revised UI files were tested under the same PATH and `ProtectSystem=strict`; only the test update state directory name was substituted to preserve existing sequence-5 configuration and history. Consent persisted with `watchdogQualified=false`, periodic checks resumed, and the actual timer became active. Nix evaluation of the revised installed configuration returned `["murakumo","aiueos-update"]`.

The actual VM remote HTTPS service passed 8-digit pairing, certificate fingerprint matching, refusal before local approval, approval, state retrieval, and refusal after session closure. The pairing ticket and code are not retained in the proof. The VM was powered off normally.

## Delivery boundary

This validates the source fix and service behavior, not a newly built ISO or closure. Production sequence 5 and the prior USB media do not contain this fix yet. No physical Node was changed. Known online same-name tailnet peers were identified as Ubuntu, so neither was treated as the pictured new NixOS machine. Its IP is needed for a targeted repair; no KIOXIA was attached to the Mac during the final disk check.

Automatic activation remains gated on real hardware recovery qualification. No watchdog qualification, owner policy, identity receipt, or anti-replay history was relaxed by this repair.

Evidence: [original failure](evidence/setup-service-recovery-20261010/setup-original-sandbox.log), [fixed service](evidence/setup-service-recovery-20261010/setup-fixed-sandbox.log), [pairing](evidence/setup-service-recovery-20261010/setup-pairing-qa-proof.json), [tests](evidence/setup-service-recovery-20261010/setup-fix-tests.log).
