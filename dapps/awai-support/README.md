# Awai support (awai-support)

Support for Awai Network as a whole, received by the `awai-support` Itonami bot on behalf of
**Awai Network LLC** (owner decision 2026-11-18). Tracking:
[AWAI-3169](https://linear.app/kotobalabs/issue/AWAI-3169), parent
[AWAI-3112](https://linear.app/kotobalabs/issue/AWAI-3112). It is **not built into the OS image**.

Whether a payment to the LLC is a donation (寄付), support or a purchase is undecided and needs
professional review. Until then every text says "support" (支援), and nothing claims to be
tax-deductible. This stage is EN devnet only: nothing here is money, revenue, a deposit or a
donation.

| Part | File | Runs on |
| --- | --- | --- |
| Pure core | `src/awai_support/core.cljc` | Babashka and nbb |
| Core tests | `test/core_test.clj` | Babashka, with `../en-devnet/src` |
| Host commands | `host/support.cljs` | nbb, with `../en-devnet/src` |
| One support on the EN devnet | `test/live_devnet.sh` | nbb node and signers from `../en-devnet` |
| Bot profile | `hermes/profiles/awai-support/` | Itonami profile source (`SOUL.md`, `profile.yaml`) |
| HTTPS support desk (AWAI-3170) | `host/desk.cljs` | nbb, loopback, with `../en-devnet/src` |
| Node and desk for a run | `test/devnet_stack.sh` | bash, openssl, nbb |
| Desk client checks | `test/desk_client.mjs` | Node, using `otehon/shell/src/awai-support.js` |
| One support from the Itonami app | `test/live_android.mjs` | Node, adb, an emulator this run owns |

## What the core decides

- **Target.** The recipient is Awai Network LLC. Only the EN devnet route is open. Crypto
  (AWAI-3113), card (AWAI-3122) and compute (AWAI-3115) are refused as `route-unavailable`.
- **Consent card.** `consent-card` lists every field the funding transfer depends on: recipient,
  sponsor, bot, amount, chain, transfer id, expiry, value class and notices.
- **Decision.** `decide` returns an unsigned funding transfer only when the answer approves the
  identical card before it expires. A denial, no answer, an approval of a changed card or an
  expired card sends nothing.
- **Receipt.** `receipt` accepts the node's readback only when the transfer finalized, the bot's
  balance rose by the card's amount and the journal holds exactly one matching `credit-received`.

The EN devnet ledger (`../en-devnet`) still decides every transfer: the sponsor and the bot each
sign with their own key, and the sponsor's credit floor applies. This core holds no keys and
performs no I/O.

## Check

```bash
cd dapps/awai-support
bb --classpath src:../en-devnet/src test/core_test.clj
test/live_devnet.sh ../../.agent-output/awai-support-live
```

## Evidence (2026-11-18, Apple M1 Max, task worktree)

| Check | Result |
| --- | --- |
| Core tests on Babashka v1.12.218 | 6 tests, 28 assertions, 0 failures |
| Live run on nbb v1.4.208, one host, loopback node | 12 of 12 checks |
| Approval check removed from `decide` (negative control) | Core tests: 1 failure. Live run: 10 of 12, the denied card produced a transfer |
| `src/awai_support/core.cljc` sha256 | `ab419ea6184e409b9e7061cb878b4511d84fd96a88993d59a25f6d5d96575b46` |

Live run evidence: [`docs/evidence/awai-support-devnet-20261118.json`](../../docs/evidence/awai-support-devnet-20261118.json).
It covers the card, two refusals that left the node unchanged, the sponsor's signature alone being
refused, the two-party transfer finalizing once, the balance and journal readback, net zero and a
node restart with the same head. Run with locally installed tools, not through `nix-shell`.

## Bot profile

`hermes/profiles/awai-support/` is the profile source. It carries no `config.yaml`, cron jobs or
capabilities; the installing owner binds accounts, the bot's signer and the approval policy, and
the default decision stays blocked. `itonami.edn`, with its bundle CID, is written at install
time by `itonami-agent profile itonamify`, so it is not committed here. Inference uses the
Itonami rail (murakumo); do not install this profile into a Hermes home with murakumo.

Registration in `cloud-itonami/itonami-registry` pins this directory at a merged commit and is a
separate step.

## From the Itonami app on Android (AWAI-3170)

The support panel sits in the Itonami context of the shell, below the agent list
([Figma 304:939](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=304-939)). It goes
through the shared consent broker for each of three operations: `prepare-support`, `send-support`
and `read-support-receipt`. They exist only in a shell built with `AWAI_SUPPORT_DESK_ORIGIN`.

- The card is the desk's exact canonical text. The panel parses it, refuses anything that is not
  devnet support for Awai Network LLC, and signs `awai.support.approval/1` with the card's SHA-256 using
  a separate, non-exportable P-256 key kept in the app's IndexedDB. It is not the device identity key.
- `host/desk.cljs` serves HTTPS on loopback, answers only the allowed web origin, and accepts a support
  only when that approval matches the card it issued. The first approval key is enrolled (trust on
  first use, devnet only), and later keys are refused. It then signs as the sponsor, has the bot
  counter-sign with its own key file, submits once, and records `ambiguous` without resending when
  the node does not answer.
- The sponsor's EN key is a devnet key file on the desk host. It stands in for a sponsor wallet and is
  used only after the device's approval. It is not key custody.
- Transport (owner decision 2026-11-18): the emulator reaches `https://localhost:18795` through
  `adb reverse`. A **debug** build trusts that run's CA through
  `apps/itonami/scripts/devnet-trust.mjs` (network_security_config debug-overrides, git-ignored,
  removed after the run). Release builds, the main manifest and `cleartext=false` are unchanged.

```bash
cd dapps/awai-support
test/devnet_stack.sh ../../.agent-output/stack &       # node, desk and a CA for this run
NODE_EXTRA_CA_CERTS=../../.agent-output/stack/ca.pem \
  node test/desk_client.mjs https://localhost:18795 http://127.0.0.1:18796 https://tauri.localhost OUT.json
# Android: build the shell with AWAI_SUPPORT_DESK_ORIGIN=https://localhost:18795 OTEHON_HTTP=1,
# run `node scripts/devnet-trust.mjs install CA.pem` in apps/itonami, build the debug APK, then:
node test/live_android.mjs SERIAL APK ../../.agent-output/stack OUT_DIR
```

### Evidence (2026-11-18, Apple M1 Max, task worktree)

| Check | Result |
| --- | --- |
| `otehon/shell` `npm test` | 113 of 113 |
| Desk client against a live node and desk | 16 of 16 |
| Desk with the approval check removed (negative control) | 5 checks fail, then the client stops on an unexpected send |
| Android emulator (API 35, arm64, 1920×1080 at density 160), debug APK from `4dd8cec` | 11 of 11 |
| Physical Awai Android OS device (MQ, x86_64, Android 17, 1920×1200), debug APK from `44a13fd` (AWAI-3340) | 11 of 11 |

Android evidence: [`docs/evidence/awai-support-android-20261118.json`](../../docs/evidence/awai-support-android-20261118.json),
[the card](../../docs/evidence/awai-support-android-20261118-card.png) and
[the receipt](../../docs/evidence/awai-support-android-20261118-received.png). On the emulator:

- A test wallet made for the run signs the app's own first-run sign-in message.
- "Cancel" on the card sends nothing. "Deny" in the broker's send-support dialog sends nothing, not even a
  preflight.
- An approved support asks the broker twice more (send, read back) and finalizes exactly one transfer.
  The panel and an independent read of the desk show the same receipt.

Physical device run (`AWAI_PHYSICAL=1`, 2026-11-18):
[`docs/evidence/awai-support-device-20261118.json`](../../docs/evidence/awai-support-device-20261118.json),
[the card](../../docs/evidence/awai-support-device-20261118-card.png) and
[the receipt](../../docs/evidence/awai-support-device-20261118-received.png), cropped to the panel.

- The app was already signed in with the owner's account, and that account was left as it was.
- In this mode the harness neither clears app data nor changes the display or system settings. It
  stops instead of signing in a test wallet.
- The previously installed Itonami APK (same signer) was reinstalled afterwards, and its sha256 was
  checked against the copy taken before the run.

Every decision was a real `adb shell input tap`. DevTools only read the page and filled the wallet
fields. The emulator display was set to 1920×1080 for the run, because the shell hides the context
sidebar below 800 CSS px, so the Itonami context cannot be opened at phone width.

## Not implemented

- Taps came from a harness, not a person. The Itonami context is not reachable at phone width.
- The panel's labels are hard-coded Japanese, not translation keys.
- Recording and publishing where received support is allocated (initiative I-15).
- Key custody beyond 0600 files, a second node or operator, and any real-asset route. Real assets
  need the owner's separate approval and the donation-or-support decision.
