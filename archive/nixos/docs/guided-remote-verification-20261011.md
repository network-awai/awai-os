# Guided remote setup verification — 2026-10-11

Implementation commit: `103296f`. Source SHA256 for `archive/nixos`, `scripts`, `ci`:
`f5a88fb8bd30bcb13ee99d4a329a4626b920b8725a039d79be4dd82f2860a570`.
The fleet CI source digest was compared with the local worktree and matched.

The new journey is **PC enters code and public keys → Node grants connection
and administrative access once → PC connects**. The GTK screen detects incoming
requests without Refresh, shows the computer and bound key fingerprints, and
advances after activation. No additional yes/no dialog is required. Browser
status-only access remains available by leaving the SSH key empty. Expired
sessions return to editable input with a specific recovery instruction.

## Verification

- Unit tests: 148 passed, 0 failed, 1 existing signed-update/policy integration
  test skipped on Mac. The new browser test checks that approval alone does not
  show SSH success before activation; protocol tests check one approval,
  fingerprint binding, expiry and invalid-key refusal without consuming the code.
- Actual service/GTK VM: incoming request appeared without a refresh key; one
  keyboard approval activated SSH; a separate peer executed `id -un` as
  `murakumo-admin` with the real host key pinned. Esc returned to local setup.
  Restart preserved update consent, anti-replay journal and TLS identity.
- Actual Kekkai VM: one owner approval bound both keys before account/Passkey
  registration. Real Noise/UDP/OpenSSH succeeded with direct LAN SSH blocked,
  reconnected after same-disk reboot, and refused new connections after revocation.
  This transport test scripts the approval through the root-only IPC socket.
- The release gate requires `singleApproval` from Kekkai and
  `remoteAutoRefresh`, `singlePhysicalApproval`, `actualSSH` from GTK. Existing
  four scored journeys each passed at 100/100; these are policy conformance
  scores, not measurements of real-user satisfaction. Physical administrative
  SSH remains outside the scored qualification.

Immutable successful VM outputs:

- `/nix/store/5rdxa7np2wsc16dc8n2c8rr20l9dhd23-vm-test-run-murakumo-setup-services`
- `/nix/store/fa8flg4qfjz1jvqlx9y9g6zav6mdsvf7-vm-test-run-murakumo-kekkai-setup`
- Evaluated target `/nix/store/vl0ls36rlcfawaqv66439snp8njrn5bv-nixos-system-murakumo-node-26.05pre-git`

Evidence: [release gate](../../../docs/evidence/guided-remote-20261011/release-vm-gate.json),
[GTK journey](../../../docs/evidence/guided-remote-20261011/journey-gui.json),
[Kekkai](../../../docs/evidence/guided-remote-20261011/kekkai-ssh.json),
[approval screenshot](../../../docs/evidence/guided-remote-20261011/remote-one-approval.png),
[ready screenshot](../../../docs/evidence/guided-remote-20261011/remote-ready.png).

## Physical device and rollout boundary

The user's physical Node at `192.168.1.11` was reachable through Gad and the
local management ticket was physically approved. Its SSH port opened after the
user approved the key, but the Mac SSH attempt returned `Permission denied
(publickey)`. Physical SSH success is **not** established. Its runtime has not
received this PR's authorized-key permissions fix or guided-flow changes.

No main merge, production deployment, ISO build or USB write was performed.
The changes and verification are added to Installer PR #25. The bootstrap still
requires LAN reachability; Internet/NAT relay provisioning remains separate.
Task-owned VM processes were stopped by the Nix tester cleanup. The Mac's
Gad forwarding session remains available for the user's setup work.
