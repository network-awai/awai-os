# Torihiki devnet trading against the live node (AWAI-3442, 2026-11-18)

The question was whether the Torihiki app can actually trade. The node is the devnet Worker `https://torihiki-node.04-feasts-minded.workers.dev` (`torihiki-devnet-1`, `/head` code-version `12`). Its collateral is unbacked and there are no real assets.

The scripts used throwaway in-memory Ed25519 keys with the app's own functions (`buildTx`, `signingPayload`, `signEnvelope`, `deriveAccount`, `headView`, `accountView`, `txView`). They did not go through the canonical consent broker, because its host cannot be stubbed outside the trusted page; the Android UI path still needs a WebView with Ed25519. All times below are UTC.

## Findings

| Log | What happened |
| -- | -- |
| `e2e-run-1.log` | As main signed before this change (50 fields, engine 6f3a28d): the deposit got `401 bad-signature`, and the height stayed 62. Nothing changed on the node. |
| `probe-field-count.log`, `probe-field-count-2.log` | The same deposit signed over 10–52 fields: only 16 fields (f0..f15) was accepted, at height 63. |
| `e2e-run-f16.log` | 16 fields with a fresh key: deposit 1,000,000 (height 64), buy 1 @ 68,010 IOC filled (65; position +1, initial margin 1,700), sell 1 @ 67,990 IOC filled (66; flat, equity 999,934), resting buy 1 @ 900 placed (67), then cancel-all got `400 unknown-tx` (68). |
| `e2e-fixed.log` | The fixed module: it reads code-version 12, picks 16 fields, and reports cancel-all as unsupported. Deposit (69), buy 2 @ 68,010 filled (70), sell 2 @ 67,990 filled (71); the position opened and closed and `/trades` shows both fills. |

## Change

- **Protocol table:** `NODE_PROTOCOLS` maps the `/head` code-version to its signing field count and its supported transactions. Only `12` is known: 16 fields, `deposit` and `order`.
- **Unknown versions:** signing is refused for any other or missing version, and nothing is sent.
- **Cancel-all:** disabled, with a note, while the node does not support it.
- **Engine vectors:** the 50-field engine vectors (6f3a28d) stay as the reference. The 16-field payload is their first 16 lines, as checked by a test.

## Left on the devnet

The resting buy 1 @ 900 from `e2e-run-f16.log` (account 9372651058480) remains on the book. Its key existed only in memory, and the node has no cancel-all, so it cannot be removed.

## Not verified

- The in-app order flow in the Android WebView. The emulator's WebView 124 has no Ed25519, so no key can be created there. A physical device was not tried.
- The node is the deprecated Cloudflare Worker (see the network-awai/app-itonami-torihiki-node README). The reference standalone node is not publicly deployed.
