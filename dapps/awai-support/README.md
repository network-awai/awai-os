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

## Not implemented

- The approval in the live run is a scripted answer. The consent screen on Awai Android OS is
  [AWAI-3170](https://linear.app/kotobalabs/issue/AWAI-3170).
- Recording and publishing where received support is allocated (initiative I-15).
- Key custody beyond 0600 files, a second node or operator, and any real-asset route. Real assets
  need the owner's separate approval and the donation-or-support decision.
