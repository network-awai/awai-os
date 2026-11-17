# User journey scoring qualification — 2026-10-10 Asia/Tokyo

Final source SHA256: `a31f97d9bf35a09d0b94414e0f97b084b324257a57c32d2585b908f3a7d158e9`.
Pinned nixpkgs: `f5c082a40f7571c266e74e80ae2e68aadd8a9fc7`.
Evaluated production target: `/nix/store/ai93izjvdm8l3av0k186hk9gqmb8sx5p-nixos-system-murakumo-node-26.05pre-git`.
VM result: `/nix/store/dggzn8hl23n21pwhxyick12pviah55ac-vm-test-run-murakumo-setup-services`.
Machine-readable [proof and scorecard](qa-user-journeys-20261010.json) passes validation against the final source digest.

The real VM test finished in **259.68 seconds** using QEMU/TCG. This duration includes boot, OCR, shutdown and reboot; it is not user-perceived latency or a calibrated hardware performance score.

| Journey | Score | Observed operations |
|---|---:|---|
| Keyboard / phone-free local owner | 100 | 3 decisions, 8 keys; English selection, local completion, no account receipt, Node details and updates visible, Esc return |
| First boot update owner | 100 | 3 menu responses including explicit consent and back; production service namespace, private config, timer, activation hold |
| Returning update owner | 100 | 2 menu responses; same disk, consent/history/TLS identity preserved |
| LAN companion administrator | 100 | 2 Node menu responses on each boot; actual HTTPS, certificate comparison, pending denial, local approval, status, revoked denial |

Coverage is **4 / 11 defined paths**. Seven paths remain unverified with null scores. Scores express the explicit automated task contract, not beauty, satisfaction, full accessibility or a successful real-phone/physical-Node account ceremony.

Additional validation:

- Relevant release/setup/scoring suite: 39 passed, 0 failed, 0 skipped.
- Full `node --test test/*.test.mjs`: 137 passed, 0 failed, 1 existing conditional integration skip.
- Fleet capability probe: 36 self-test cases passed. Mac gate correctly returns 91 (no VM verdict), not green.
- Real Esc mutation: the VM build exited 1 with `MURAKUMO-UX-ESC-FAIL`; qualification wrapper exited 0. This run used the preceding source digest `94c5ddcfe1ffd9aa707ad38b96d5812173932986c91883525895aabe480dfc6d`, before adding the menu minimum height and visibility assertion. The Esc implementation did not change in the final patch.
- Real menu-visibility mutation: the final-source disposable VM build exited 1 with `MURAKUMO-UX-MENU-FAIL`; qualification wrapper exited 0. Removing the menu viewport minimum reproduces the clipped-choices failure.

The layout issue was reproduced by visual inspection at 1280×800: the long completion explanation squeezed the inner menu to a partly visible first item. The final GTK menu minimum content height is 240 pixels. Real OCR now requires both Node details and NixOS updates before keyboard continuation; the final screenshot was also inspected. Other viewports and Japanese rendering remain separate qualification work.

Full logs/screens are preserved in `/Users/junkawasaki/github/workspaces/codex/murakumo-ux-ci-20261010` and the operator's Linux QA workspace. Historical runtime ENOENT mutation evidence is recorded in [the earlier VM qualification](qa-vm-release-gate-20261010.md); those runtime paths were not changed here.

This is a trusted operator VM run, not an automated fleet-green receipt. Both PRs remain draft, fleet CD remains false, and dedicated non-root runner provisioning is awaiting explicit approval after automatic approval review rejected the account/KVM permission addition. Production, latest ISO and USB publication are not performed by this qualification change.
