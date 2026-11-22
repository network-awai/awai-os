# Awai compute (awai-compute)

Compute support for Awai Network (AWAI-3115, parent AWAI-3112), C1 only.
An Android device (Murakumo llama.cpp real inference, AWAI-3011) is the
provider: it signs an Offer (`awai.compute.offer/1`), accepts a sanka
compute Order, runs the inference locally, and returns a signed work
receipt (`awai.work-receipt/1`). The bot acts as the acceptor and funds
the provider with a devnet-only EN devnet `:compute-funding` transfer
(bot -> provider), reuse of the EN devnet ledger in `../en-devnet`
(AWAI-3101/ADR 0027).

**devnet and simulation only in this stage.** Nothing here is money,
revenue, a deposit or a donation. C2 (the "resources to give" button UX,
AWAI-196) and C3 (real node path AWAI-234, production evidence AWAI-140)
are out of scope and untouched. The credit unit is provisional: one
compute order consumes one devnet credit today; that constant lives in
`src/awai_compute/core.cljc` (`provisional-credit-per-order`) so
replacing it is one edit and nothing in the phone hard-codes a meaning.

| Part | File | Runs on |
| --- | --- | --- |
| Pure core | `src/awai_compute/core.cljc` | Babashka and nbb |
| Core tests | `test/core_test.clj` | Babashka, with `../en-devnet/src` |
| HTTPS compute desk (AWAI-3115) | `host/desk.cljs` | nbb, loopback, with `../en-devnet/src` |
| Shell client (3 ops) | `otehon/shell/src/awai-compute.js` | WebView (Android), through the shared consent broker |
| Shell client tests | `otehon/shell/test/awai-compute.test.js` | Node |

## Keys and trust

- **Provider key**: a non-exportable P-256 key on the device
  (WebCrypto/IndexedDB in the shell; Android Keystore in the phone
  native host). It is separate from the device identity key. It signs
  the Offer (`awai.compute.offer/1`) and the work receipt
  (`awai.work-receipt/1`). The prompt and the output body are never in
  the receipt.
- **Acceptor key**: the desk host's bot key signs the Order acceptance
  and the funding transfer from the desk. It is a separate key, devnet
  only. The sponsor key stays in the support desk; its ACL and the EN
  devnet operator rules are unchanged.

## What the core decides

- **Offer.** `offer-card` builds the card the provider signs: protocol
  kind, provider and consumer dids, amount, order id, expiry and chain.
  Only the `:en-devnet` route opens. Every field the funding transfer
  depends on is on the card, so signing the offer signs exactly that
  transfer. The unit of credit is the provisional constant named above.
- **Decide.** `decide` returns a funding request only when the answer
  approves the identical card before it expires. A denial, no answer,
  an approval of a changed card or an expired card sends nothing.
- **Work receipt.** `work-receipt` is the doc the provider issues after
  real inference: order-id, provider, transfer-id, height and credit.
  No prompt, no output body, no personal data, ever.
- **Receipt.** `receipt` accepts the node's readback only when that
  transfer finalized, the provider's balance rose by the card's amount
  and the journal holds exactly one matching `:credit-received`.

The EN devnet ledger (`../en-devnet`) still decides every transfer:
the acceptor and the provider each sign with their own key, and the
acceptor's credit floor applies. This core holds no keys and performs
no I/O.

## From the Itonami app on Android

The compute ops exist only in a shell built with
`AWAI_COMPUTE_DESK_ORIGIN`. Without it there are no compute operations
and no extra CSP origin. Each of the three operations asks for consent
through the shared consent broker:

- `prepare-compute` — `POST /v1/compute/offers` → `{order-id, offer-text}`.
  The provider signs the offer text with its non-exportable P-256 key.
- `run-compute` — `POST /v1/compute/orders` with the signed offer. The
  desk verifies the provider's signature, enrolls its SPKI on first use
  (devnet trust on first use), signs as the acceptor and the bot,
  submits once and never resends without an answer.
- `read-work-receipt` — `GET /v1/compute/receipts/:order` → the node's
  readback (balance before/after and journal).

## Check

```bash
cd dapps/awai-compute
bb --classpath src:../en-devnet/src test/core_test.clj
```
