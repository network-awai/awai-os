# User-rooted Node linking

Status: narrow Node-linking implementation deployed; physical Node delivery and
real-phone approval remain separate qualification gates. Authority:
[root PR #3529](https://github.com/com-junkawasaki/root/pull/3529), merged as
`3ab11be9f8c86def4967a397784fb164fc5a4e7d`; ADR-2610091510 and ADR-2610091640.
These supersede restoring the retired kotobase-authn service as the default plan.

## User journey

1. Install NixOS offline. Reuse connected Ethernet or saved Wi-Fi automatically.
   Preserve the Node's existing did:key identity, network profiles and data.
   Local setup can finish before an account is linked.
2. Open setup.murakumo.cloud from the Node QR or on another computer. The code
   identifies a pending request; possession of a QR, acoustic code or 8-digit remote
   code never grants ownership. Display the Node identity, requested capabilities,
   request origin and expiry before approval.
3. Choose **Passkey / Base account** or **Connect an external wallet**. Keep both
   entry buttons available without Privy. Privy may supply the external-wallet
   connection modal only; a connected address is not authenticated.
4. For Passkey, a user click opens a top-level auth.kotoba.cloud signing window.
   Preserve that RP ID. Do not call the root Passkey from a Murakumo iframe or
   enable related-origin root signing. The signing page must show the exact Node,
   requesting origin, capabilities and expiry. Use content-addressed builds, SRI
   and CSP, with exact popup origin/source checks.
5. Delegate narrowly to the browser's non-exportable session key and the specific
   Node key. Bind approval to the immutable request CID, Node DID, fresh single-use
   challenge, audience, chain and expiry. Prove control of the Base smart account
   with ERC-1271, or ERC-6492 for an undeployed account. An external EOA signs the
   bounded dango root capability with ERC-191; this is not a SIWE session.
6. The registration boundary verifies the user-rooted capability chain, current
   account/registry authority, attenuation, revocation and request binding before
   accepting the claim. The Node verifies its bound receipt before persisting it.
   A cookie, Privy user/JWT or server response asserting valid=true is insufficient.
7. Show the linked account and Node status. Offer a second owner credential as a
   separate explicit action. Linking a Node does not authorize payments, restore
   another identity, establish fleet inference or disclose saved Wi-Fi secrets.

## Integration order and acceptance gates

- Implement the canonical signing page and EIP-1193/EIP-6963 provider first.
  Announce the provider before Privy mounts; qualify popup discovery on real
  browsers. Keep direct Passkey and direct external-wallet entry if Privy fails.
- Privy Dashboard permits wallet only. No login, loginOrLink,
  connectOrCreateWallet, embedded wallets, JWT authority or server signer.
  Verify source, built artifact and browser traffic, rather than trusting config.
- Qualify user-rooted delegation on Base Sepolia before mainnet. Reject a wrong
  Node, altered CID, wrong popup origin/source, reused challenge, expired grant,
  changed/revoked owner, Privy JWT and legacy-cookie-only claim. Refuse when chain
  authority cannot be checked. Fixtures are not real-phone Passkey qualification.
- Switch the setup Worker and Node protocol together; never change the QR URL
  alone and claim authentication repaired. Record the old wire format as legacy
  until migration is qualified. Do not implicitly merge old DID accounts with a
  new wallet address or mint new server-held root keys.
- Keep spend permission and account recovery separate. No payment permission is
  requested just to link a Node. Recovery-module mainnet activation requires its
  own audit; Privy and operators are not guardians.

## Current evidence boundary

The canonical signer is deployed at `auth.kotoba.cloud`, with Privy used only
for external-wallet connection. The registration Worker independently checks
user-root capabilities; the installed Node independently verifies the public
receipt before saving version 2. Existing server custody and account migrations
elsewhere in the ecosystem are not completed by this narrow Node flow.

On 2026-10-09, production registration source
`111ef2c913e778313c5d41f2ed98abde2a3ad1e4` was deployed as
`63085e1f-81a0-47f9-9e92-49c65d1e0b99`. A signature refusal on the former fixed
Base RPC path was recovered by selecting a different fixed operator-configured
Base endpoint. Verification still fails closed; caller-selected RPCs are not
accepted. A temporary unfunded EOA and a virtual WebAuthn Passkey each passed
real production approval, actual Node receipt verification, version-2 persistence
and a saved-record re-read. The virtual Passkey also passed read-only Base
mainnet verification. No transactions or real-phone ceremony were performed.

The user reports phone authentication succeeded but the physical Node is not
registered. This remains incomplete until a fresh request is approved and the
Node reports completion. An authentication screen alone is not registration
completion. Automatic update activation remains gated on owner policy and
physical recovery qualification; a timer being active does not establish it.

## Legacy registration recovery

A matching version-1 record is retained as migration evidence, not accepted as
user-root authority. Setup offers explicit account linking again with the same
Node identity and saved network configuration. Cancellation, service failure or
an unsigned server response leaves the old record intact. Only a freshly
verified user receipt replaces it atomically with version 2. A mismatched or
unreadable record remains blocked for maintenance; boot does not start a claim.

Recovery checks: account-link, setup-flow and registration-ui tests: 27 passed.

## Physical Node handoff

Use the newly written KIOXIA to boot the Node, then choose **Update existing
NixOS**. This path preserves device identity, network profiles and stored data;
reinstallation is unnecessary. Restart from the internal disk after removing the
USB. Open **Link account using a phone or another computer** and use a fresh QR.
On `auth.kotoba.cloud`, use the existing owner credential, compare the Node ID
and approve the request. Completion requires the Node's registered state, not
only the phone's authentication result. Creating a new Passkey is a separate
account and never implicitly merges the previous identity.

The **NixOS updates** screen exposes status and manual signed checks. Periodic
checks can be enabled through the owner's standalone policy. Automatic
activation remains held while physical recovery qualification is false; USB
update qualification in a VM does not release this hardware gate.

## ISO and VM delivery qualification

The runtime revision is Installer main
`a35fca0eccde9e7c3860fa512b40c8538a4c118d` (PR #18). The immutable snapshot
was built with pinned Nixpkgs and exported as a 5,248,696,320-byte ISO, SHA-256
`7293c23edd4ceaaca9ba2a18dee1acc9b2f0c64e5c793b1163453bdf959c7ff8`.
Mac hashing matched the transfer receipt. The bundled public receipt verifier is
`ac71377f95afd1d25c5767fe1f470a887b77020fbe28dd2eee64a70eedd2a3a0`.

On a dedicated QA disk overlay with no NIC, the actual ISO updater completed and
retained hashes for device identity, legacy account evidence, saved data and a
NetworkManager profile. The new system profile is
`/nix/store/6904529k5ragcl7dy2ww58q54dvjnvl7-nixos-system-murakumo-node-26.05pre-git`.
Generation 8, previous system GC root and boot entries were retained. Legacy
ownership remained unverified and explicit relinking was offered.

The same disk booted through UEFI without a CD or external kernel/initrd. The
running system matched the update receipt, all four hashes still matched,
NetworkManager was active and the update timer was present. The installed
account module reported that fresh user proof is required for the legacy record.
QA boot entries add serial output and mask the account GUI service solely for
this headless test. GUI rendering, fresh installation from a blank disk, physical
boot/recovery and real-phone approval are not established by these VM results.

Receipts are in [user-root-production-20261009](evidence/user-root-production-20261009).
The USB source is newer than remote production sequence 4; the preserving updater
retains the sequence floor so that older release cannot replace this manual update.
No new automatic fleet release is promoted by this qualification.

The fixed KIOXIA TransMemory (serial `0022CFF6B899CA205987CBC4`, capacity
61,949,214,720 bytes) was written with this ISO, read back for exactly
5,248,696,320 bytes and safely ejected. ISO and readback SHA-256 both match the
hash above. The fixed helper ran without another password prompt; its request
was returned to non-destructive check mode. Task-owned builder and QA VMs were
normally shut down. The expired QA signing tab was closed; user apps and VMs
were left alone. The USB is ready to unplug. Physical Node registration remains
pending the user's update and fresh credential approval.
