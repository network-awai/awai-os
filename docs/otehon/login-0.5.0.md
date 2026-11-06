# Awai Otehon sign-in and trust 0.5.0

First-run setup, required sign-in with a phone, and a trust score that apps and
operations can require (`network-awai/network-awai-apex` ADR 0026 D13, AWAI-160).

This runs in a VM with a relay on loopback. Nothing is deployed:
`awai.network/link/` and `relay.awai.network` do not serve this yet, so a real phone
cannot sign in. The desktop image opens at setup and cannot get past sign-in.

## Setup

Hello, Language, Network, Sign in, Trust Score, Done. Sign-in has no skip. After setup
is finished, a device with no valid link opens directly at sign-in. It is a setup
assistant for an image that is already on the disk: it does not partition or install
to a disk. Only the setup screens are translated (English and Japanese).

## Sign-in

1. The OS asks for approval to connect to the relay through the shared consent host.
   Denying sends nothing.
2. It shows a QR code for `https://awai.network/link/#...` and a confirmation code. The
   fragment is not sent to the web server.
3. The phone page shows the same code. The person approves with a passkey or a wallet.
4. The phone encrypts the answer to a key that exists only in the OS browser and posts
   it to the relay, after its own consent prompt.
5. The OS decrypts and verifies the answer. Anything else is refused and it keeps
   waiting.

| Route | Account | Verified on the device |
| --- | --- | --- |
| Wallet | `did:pkh:eip155:<chain>:<address>` | EIP-4361 message for this device and nonce, secp256k1 recovery |
| Passkey | `did:key` (P-256) | Challenge for this device and nonce, origin, RP ID, user verification, ES256 |

A link lasts up to 30 days, and each device has its own. Linking a second device with the
same wallet or passkey gives the same account. The link is verified again on each load.

The relay is ntfy, with no custom server. It holds ciphertext, and the topic is random.
Both pages use the pinned shared broker in `nixos/otehon/shell/vendor` (see `PINS.json`),
and a test checks its digests. The phone page is `nixos/otehon/shell/link`, built to
`dist/link`.

## Trust score

| Source | Points | State |
| --- | --- | --- |
| Signed in | 10 | Works |
| Human Passport, score 20 or more | 40 | Reads the decoder on Optimism, for wallet accounts. Not exercised against a real score |
| World ID | 50 | Not implemented |

Proofs last 30 days and belong to one account. Minimums are in
`nixos/otehon/shell/src/dapp-trust.json`: Torihiki `submit-order` and Saifu
`read-chain-state` need 50. A whole dapp can also have a minimum, which opens a locked
screen. No dapp has one yet.

**The score is a local check.** A person with control of the device can edit it. A service
that accepts an operation must verify the proofs itself. The score is not an identity
check and does not replace the responsibility binding in ADR 0018.

## Check

Unit tests run in the Nix build (`npm test`), so a failure stops the image.

Build the `desktop-login` profile. It adds a relay on loopback, a throwaway certificate,
`--ignore-certificate-errors`, Node.js and a test driver, so it is never a release.

```bash
nixos/otehon/desktop-login-check-qemu.sh desktop-login.qcow2 serial.log shot.ppm
```

Exit codes: `0` every step passed, `1` a step failed or no result, `3` the check could
not run. The driver controls the real shell through DevTools with trusted input and uses
random software keys in place of a wallet and a passkey.

## Evidence (2026-11-07, Apple M1 Max, QEMU 10.0.3 with HVF)

Raw image `7d3e49223c8a91966dc92d324e6e4d323943e6f9c358a58f3cbc67f97b1be158`, 54 s, exit 0.

| Step | Checks |
| --- | --- |
| `gate` | Setup is shown and no dapps are rendered |
| `setup_steps` | Language applies, and sign-in has no way past it |
| `consent_deny` | Denying shows no QR code |
| `consent_allow` | A trusted click allows, and the QR code appears |
| `wrong_signer` | A forged address is refused, and the apps stay hidden |
| `wrong_key` | A message that cannot be decrypted is refused |
| `wallet` | Sign-in works, 18 dapps appear, the account matches, the score is 10 |
| `trust_lock` | `submit-order` is locked and `read-quotes` is not |
| `reload_keeps_login` | A reload stays signed in |
| `tamper_returns_to_login` | An edited link returns to sign-in |
| `passkey` | Sign-in works with `did:key` |
| `sign_out` | Sign-out returns to sign-in |

17 unit tests also pass, including refusals for another device, origin, RP, challenge,
expired request or session, an over-long session, and no user verification.

## Not verified or not implemented

- A real phone, wallet or passkey. The phone page was only opened in a browser and its
  buttons were not pressed.
- The published origin, TLS, DNS and a relay on the internet.
- Reading a Human Passport score above zero. One real call to the decoder for an address
  with no score returned a revert, which the code counts as 0.
- World ID, which needs an app registered by the owner, and WalletConnect. A wallet works
  only inside a wallet's browser.
- Smart contract wallets (ERC-1271). Only keys that sign directly are verified.
- Removing a device from the phone, or from another device. A device can only sign itself
  out, and a link cannot be revoked remotely before it expires.
- Syncing a passkey to a new phone. The public key is stored on the phone that created it,
  so another phone cannot use it yet.
- The device key is created but does not sign anything yet.
- Network settings. The Network step only reports the browser's status.
- Storing state in the encrypted volume from [base-0.4.0.md](base-0.4.0.md).
