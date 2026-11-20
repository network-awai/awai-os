# User journey quality in CI/CD

The release VM gate now produces `murakumo.journey-score.v1` under `journeyScore` in its proof. ISO build, export/publish and signing require this evidence. The fleet gate checks it as well. There is no new GitHub Actions workflow.

These are **task conformance scores**, not satisfaction, conversion, beauty or accessibility certification. A high score applies only to the named tasks and evidence levels. No aggregate score can hide a failed journey. Unverified paths have `score: null`, never zero or 100.

## Journey map and evidence

| User / task | Path | Evidence | Budget |
|---|---|---|---|
| New owner without phone/account | Language → complete locally → updates → Esc back | Real GTK keyboard + OCR, local state file, absence of account receipt, visible Node details/update choices, screenshots | 3 decisions, 8 key presses including language selection and return |
| Owner enabling updates | Updates → enable → explicit consent → back | Production service namespace, actual update UI with scripted selections, saved policy + active timer | 3 menu responses including back |
| Returning owner | Reboot → updates → resume → back | Same VM disk, preserved config/history/certificate, actual service UI | 2 menu responses |
| LAN administrator | HTTPS address + certificate → 8-digit code → local approval → status → end session | Actual TLS daemon/API, scripted production remote UI, pending denial and revoked denial, two boots | 2 Node menu responses; companion HTTP operations are not included in this budget |

The graphical test has no network gateway/Internet connection. A local setup must not call registration or require a phone. The language screen is tested in English; Japanese rendering and physical keyboard layouts remain separate qualification work. The first menu budget begins after OS installation: this does **not** certify the disk installer.

Unverified journey matrix: disk installation, real phone Passkey/account registration, Wi-Fi provisioning, Bluetooth provisioning, AI voice conversation, administrative SSH and physical hardware update recovery. Current automated coverage is **4 / 11** defined paths. Phone authentication, Node registration, authorization, fleet inference and update activation are distinct outcomes.

## Scoring policy

Each journey scores 0–100 against four binary, observable dimensions:

- Completion: 40 points. The named terminal outcome is established. The keyboard journey also requires the essential Node details and update choices to be visible without first focusing hidden choices.
- Safety: 30 points. Local setup does not claim an account; update checks preserve owner consent and hold activation until recovery qualification; LAN control requires certificate comparison and local approval.
- Recovery: 20 points. Esc returns from the actual GTK update screen; update menus return; LAN session is revoked on exit.
- Effort: 10 points. Positive integer operation counts remain within the explicit budget above. Required consent/certificate/approval steps remain mandatory.

Every required journey must score at least **95**, and completion and safety must pass independently. With these weights, any failed dimension currently blocks release. This intentionally prevents a good average from hiding a blocker. It is a regression contract, not an empirically calibrated human usability threshold. Change budgets/policy only with reviewed evidence; do not tune them to hide a failed run.

The policy, probe and graphical driver live under `archive/nixos/tests`, included in the release source SHA256. The gate recomputes scores from VM observations and compares the complete report, rejecting missing, altered or incompatible evidence. Signing binds the report to the tested system/source. This is evidence from a trusted CI runner, not an independent cryptographic VM attestation.

## Artifacts and verification

`check-setup-vm.mjs PIN` prints the complete proof and scorecard as JSON. The Nix VM output contains `journey-gui.json`, both boot reports and screenshots: language selection, mode selection, local completion, Esc return. Retain this output with the release proof. A failed VM produces no green proof.

`node --test archive/nixos/test/journey-score.test.mjs archive/nixos/test/release-vm-gate.test.mjs` checks missing evidence, increased operations, missing Esc, approval bypass, revocation failure, premature activation, lost saved consent and report tampering. These are score-policy regression tests. The VM's keyboard/OCR path also catches a frontend Esc failure before publication; physical/voice paths cannot be certified by these unit tests.

On 2026-10-10 the owner approved dedicated CI runner provisioning. The non-root `murakumo-ci` account on the 6600HS fleet host has KVM and Nix daemon access, without copied credentials or sudo privileges. The normal fleet `ci-verify` path passed Installer PR #24 (`97767eb`) with signed receipt `7883be8aaa54` after authoritative west-derived DB and SSH alias fixes. Main integration and standing operation are recorded separately in the fleet activation report. Existing production/USB builds are not changed by this CI-only work.

The optional `escape-return` mutation in `archive/nixos/scripts/check-setup-vm-negative.mjs PIN LOG_DIR escape-return` removes the actual frontend Esc handler. The real VM must fail with `MURAKUMO-UX-ESC-FAIL`; this qualification is separate from the unit score mutations. Default invocation now qualifies all four runtime/keyboard/layout regressions.

The `menu-visibility` mutation removes the minimum GTK menu viewport height. The real VM must fail with `MURAKUMO-UX-MENU-FAIL`. This catches a reproduced layout regression where the long completion explanation left only part of the first menu item visible at 1280×800. Other viewports and visual/accessibility qualities remain unqualified.

Measured results and scope: [2026-10-10 qualification](qa-user-journeys-20261010.md).
