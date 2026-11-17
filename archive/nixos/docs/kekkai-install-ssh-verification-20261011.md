# Kekkai installation SSH qualification — 2026-10-11

Implementation: `221ee85`, based on Installer main `e798934`.
Verified source SHA256 (NixOS, installer and CI scripts):
`6990bfb0efe823ed64c1fa41cae585ff792a0d422e0197a3d7aca16ee082149a`.

143 unit tests passed; one existing signed-update/policy integration test was
skipped on Mac. The frozen runtime's namespace hashes and actual X25519 key
provider passed. Existing SSH identities were preserved; the first local key
was generated automatically. Tests cover approval key replacement, cancellation
while publishing/installing, and cleanup after failed activation.

The fleet CI user ran both actual NixOS VM tests with pinned nixpkgs
`f5c082a40f7571c266e74e80ae2e68aadd8a9fc7`. The production service/GTK test
passed first boot, persistent state, update consent, timers, LAN pairing,
revocation, same-disk reboot, language selection and Esc return. Its four
existing scored journeys each passed at 100/100; that score is task conformance,
not a rating from human users.

The second test used two VMs and real Kekkai Noise/UDP/TCP plus OpenSSH. Direct
LAN SSH to the Node was blocked by the manager firewall. It passed certificate
pin refusal **before sending the pairing code**, no SSH before owner approval,
both-key fingerprint approval, automatic first-key creation, actual
`murakumo-admin` remote execution without an account receipt, pinned SSH host
identity, reconnect after reboot and removal of the SSH grant/Kekkai service.
Approval on the physical console was simulated by the root-only control socket;
the transport and SSH were not mocked.

Immutable outputs:

- Production service and GUI:
  `/nix/store/7bykg2l3rmljm33cnx44k1kfrr2w64ph-vm-test-run-murakumo-setup-services`
- Kekkai SSH:
  `/nix/store/wyzy0p3fgrnsbjvw4rv3g7xal7iyli9v-vm-test-run-murakumo-kekkai-setup`
- Evaluated production target:
  `/nix/store/l78v6c2j5j3hxqd8bhygx7fmlqnq0574-nixos-system-murakumo-node-26.05pre-git`

[Release gate proof](evidence/kekkai-setup-20261011/release-vm-gate.json) and
[Kekkai assertions](evidence/kekkai-setup-20261011/kekkai-ssh.json) are preserved.
The proof was checked again against the final local source digest. The ISO
configuration also evaluated successfully with live-installer remote access
enabled; an ISO image was not built in this qualification.

This does not qualify physical Mac/Node connection, actual disk migration of
approved keys, mobile Passkey, hardware Wi-Fi/audio, Internet/NAT relay use,
or hardware update recovery. No new ISO, USB write, production deploy or main
merge occurred during this qualification. The existing GUI score continues to
mark the full administrative-SSH UX unverified; the new technical SSH VM gate
is a separate mandatory release check.
