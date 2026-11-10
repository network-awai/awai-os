# Awai Otehon: Saifu and Passkey Wallet

This document distinguishes the current Otehon implementation from the intended
Passkey-first, multichain experience. It does not replace the wallet protocol
ADRs or authorize a migration of an existing account.

## User experience

The linked Passkey identifies the signed-in user. The Account view retains the
DID and Trust score; the Wallet control shows currency and balance state rather
than Trust. Saifu displays EVM, Bitcoin and Solana separately. Passkey wallet
creation and Bitcoin/Solana connections are shown as being prepared until their
actual account bindings are available; a sign-in alone does not prove that any
chain wallet exists.

For a previously linked EVM address, Otehon can request an Optimism ETH balance
after the user approves that specific external operation. Public chain reads
have no additional Trust threshold; approval remains required for each request.
Denial or an
unavailable account must not be represented as a zero balance. This is a
read-only path; it does not perform a transaction.

## Architecture and remaining decisions

- The intended EVM path uses a Passkey P-256 owner for a smart account. The
  current offline calculator needs an explicit owner public key, factory,
  implementation and nonce. A public test vector passes; it is not wired to
  account creation or signing. Mapping Otehon's linked identity to the
  canonical principal and nonce, including RP and recovery semantics, remains
  to be resolved before connecting this calculation to a real account.
- Bitcoin and Solana require their own chain-compatible key and signing
  approaches, private binding to the user's identity, recovery and approval
  flows. Their presence in the UI is a design intention, not a claim that keys,
  addresses, balances or signing exist. A Passkey is not treated as an
  automatically interchangeable Bitcoin or Solana private key.
- External reads and future signing requests must disclose the operation and
  destination and obtain the applicable fresh user approval. The app runs on
  the user's device and communicates through the shared client-runtime broker.

## Linking and recovery

Otehon currently verifies an `awai.network` WebAuthn assertion and derives a
`did:key` from that Passkey's public key. This is a login identity, not proof
that the key controls an existing Cloud Itonami Principal or Wallet. A local
helper can calculate an **unbound candidate** from a verified assertion and
explicit factory, implementation and nonce; the caller must not treat this as
an account migration, a published receive address, or proof of ownership.
The stable Principal, first owner, nonce and contract configuration must be
resolved and authenticated before an existing Wallet can be attached.

Recovery and controller changes have different outcomes:

| Situation | Required behavior | Current Otehon status |
| --- | --- | --- |
| Same Passkey synced or presented from another device | Verify the same RP-scoped key and link the device; keep the original Wallet descriptor. | Device link exists; Wallet descriptor association is not implemented. |
| A newly created Passkey | Keep it a candidate until an existing on-chain owner explicitly adds it and the target chain confirms owner membership. | Owner-addition and chain receipt checks are not implemented in Otehon. |
| All Wallet owners lost | Do not infer recovery from email, session, or a new Passkey; use only a separately implemented and audited recovery mechanism. | Guardian and delayed recovery are not implemented. |
| Bitcoin or Solana wallet restored | Recover through that wallet's own mechanism, then privately re-establish both sides of the account binding. | External-wallet binding and verification are not implemented. |

The proposed first phase uses Bitcoin BIP-322 and Sign In With Solana for the
asset-key proof; the account must also authorize the binding. A one-sided proof
or address alone is insufficient. No Passkey PRF is used as a seed for chain
keys. This is an implementation target, not a claim of completed recovery.

## Installing Saifu into an Otehon image

The default image has no Saifu package configured and displays it as not
installed. `otehon.saifu.pins` and `otehon.saifu.bundle` must be provided
**together** as Nix paths to installer-controlled public pins and a signed
bundle. The pins include the trusted publisher, immutable revision, descriptor
and app digests, and the app size limit; the bundle cannot establish its own
trust. The build verifies the signature and digests and only then includes the
specific script and style hashes in the host CSP. At runtime the package is
verified again and mounted in a restricted iframe, with balance requests routed
through the host broker. An invalid package fails closed. Test keys and fixture
bundles are not production release material.

The optional bundle path has passed local signature and build tests, including
negative controls. It has not yet been qualified in a browser or QEMU with an
installed production-signed package. Production pins and distribution, real
wallet creation and recovery, actual balances, signing, transactions, and
Bitcoin/Solana integration remain open. See AWAI-542 and the linked review for
current validation.
