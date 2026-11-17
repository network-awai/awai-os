# Sanka confirmation cards (ADR 0027 V4)

`network.awai.sanka` is a small plain-Java APK in which the owner approves an order and accepts or
rejects its result. The bot's EN signer (`dapps/en-devnet/host/signer.cljs`) refuses to reserve
without that approval, and refuses to pay without that acceptance. Tracking:
[AWAI-3123](https://linear.app/kotobalabs/issue/AWAI-3123).

**Status: qualification prototype.** The cards prove the trust boundary. They are not the product
UI: they have no Figma design (required by the Otehon design-first contract) and their labels are
hard-coded Japanese/English, not translation keys. Both are needed before the cards are shown to
users.

## How it works

- The app has no INTERNET permission. A request arrives in its private files:
  - `request.kind`: `order` or `acceptance`;
  - `request.bin`: the canonical order or receipt bytes;
  - `answer.json`: for acceptance, the canonical answer message.
- **Order card:** this Activity draws native Views from fields parsed out of those bytes (provider,
  amount and asset, value class, expiry, data sent, model, max tokens, demand, order CID). No
  WebView, dapp or model draws it.
  - Approve or Deny signs `awai.sanka.approval/1`, binding the CID of the same bytes.
- **Acceptance card:** shown only when the answer's CID equals the receipt's `output`; otherwise
  there are no buttons.
  - Accept or Reject signs `awai.sanka.acceptance/1`, binding the order CID and the receipt CID.
- The key is a non-exportable P-256 key in Android Keystore (`awai.sanka.owner-approval`). It is
  used only after a tap on this Activity's own button. The buttons drop taps that pass through
  another app's overlay.
  - This device key stands in for the owner's Passkey or wallet (ADR 0026 D13). On this build it
    needs no user authentication.
- The signed statement goes to `result.json` as `{payload, sig, spki}`.

## Signer side

| Command | Refuses |
| --- | --- |
| `enroll DIR SPKI` | A key that is not P-256; a second enrollment |
| `reserve` / `propose` once a key is enrolled | Always: `owner-approval-required`, `owner-acceptance-required` |
| `reserve-approved DIR NODE ORDER.json APPROVAL.json` | Bad or foreign signature, another order, `deny`, stale approval, non-devnet, expired order, receiver outside the allowlist |
| `settle-accepted DIR RECEIPT.json ACCEPTANCE.json TTL` | Bad signature, another receipt, a receipt for another order, no reservation. `reject` releases the reservation and pays nothing |

## Build and run

```bash
python3 android/sanka/build.py                  # .agent-output/sanka/sanka-debug.apk
python3 android/sanka/test/live_v4.py --serial emulator-NNNN --apk $PWD/.agent-output/sanka/sanka-debug.apk --out $PWD/.agent-output/sanka/run
```

Run it only on an emulator this run owns. The harness installs the APK, writes requests with
`run-as`, checks the cards with `uiautomator dump`, and taps with `adb shell input` in place of the
owner's finger.

Evidence: [`docs/evidence/sanka-v4-20261118.json`](../../docs/evidence/sanka-v4-20261118.json) and
[the order card](../../docs/evidence/sanka-v4-20261118-order-card.png).

## Not shown

- Passkey/WebAuthn or wallet authorization, user authentication on the key, and hardware
  attestation.
- A physical device, and taps by a person.
- A real receipt from the provider desk: the V4 receipt is a fixture with the V2 shape. V5 binds a
  real one.
- How requests reach the app outside a test (Itonami shell integration), and Hermes proposing the
  order.
