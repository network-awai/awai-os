# Torihiki trade UI on Awai Android (AWAI-3415, 2026-11-18)

This implements the AWAI-3402 Figma proposal (file `umqCqP5KSjLWh9fhCI1HaN`, page `315:2`) in the Torihiki Android client (`android/client/torihiki.js` and `client.css`).

It is evidence from a disposable emulator only:
- It does not prove a physical device.
- It does not prove that an order was signed or sent.
- It is not an owner design acceptance.

## What changed

- **Tabs:** 取引 (trade), チャート (chart) and 口座 (account) sit in a fixed bottom bar. An order ticket view has a back button, and the OS back gesture closes the ticket.
- **Trade tab:**
  - Price header and stats, then a compact candle chart.
  - 板 (order book) with cumulative depth bars, or 約定 (recent trades).
  - Fixed 買う/売る buttons that carry the best ask and best bid.
- **Chart tab:**
  - Candles with volume and a choice of 1, 10 or 50 blocks per candle.
  - Open/high/low/close of the last candle.
  - The axis always shows at least 0.2% of the price and uses round steps, so a flat devnet series does not look like a crash.
- **Order ticket:**
  - Buy/sell, limit or IOC, and price shortcuts (best ask, mark, best bid).
  - Quantity shortcuts.
  - Estimated required margin and taker fee, computed from the market's own rates. Rates are integers scaled by 1e9; 25000000 is 2.5%, which matches the 40× maximum.
  - Signing first reads `/head` and the account (each read with its own consent), then shows a review dialog, then the canonical broker consent for `POST /tx`.
- **Account tab:**
  - The device key card, equity, collateral and positions.
  - devnet funds, cancel all orders, the node status, and key deletion.
- **New declared reads**, each its own `each-operation` consent, and the host allowlist matches them:
  - `read-trades`: `GET /trades?market=1`.
  - `read-candles-1`, `read-candles-10` and `read-candles-50`: `GET /candles?market=1&span=1`, `span=10` and `span=50`.
- **States:**
  - Not yet fetched.
  - Denied: 「拒否しました」, nothing sent, values kept with their fetch time.
  - Loading: the button is disabled and reads 取得しています….
  - Error with retry.
  - Possibly stale: the head height has not changed for more than 60 s.
  - Order accepted or rejected, with the node's reason.
- **Tokens:** `--market-*`, `--status-*`, `--border` and `--error-container`, with light and dark values from the Figma `Awai DS · market & status` collection. Buy and sell always carry ▲/▼ and the words 買い/売り.

## Checks

- `node --test` on each `android/tests/*.test.mjs` passes: domain 8, identity 1, online 5, setup 4, torihiki 11. The new torihiki tests cover:
  - the trades and candles views (live shapes plus negative controls);
  - which span URLs match, and which are refused;
  - the rate scale;
  - the chart axis steps.
- `android/build.py --version 1` passes under `forest-storage run`, and the `torihiki-v1.apk` rebuilds with `--skip-cljs` pass too.

## Disposable emulator (Android 15 `AE3A.240806.019`, fresh AVD on port 5814, deleted afterwards)

| Screen | Result | Evidence |
| -- | -- | -- |
| Start | Not-yet-fetched card, devnet chips, fixed 買う/売る and tabs | `ui-01-initial.jpg` |
| Deny on `read-market` | 「拒否しました。何も送信していません」; the price stays at — | `ui-03-denied.jpg` |
| Allow `read-market` and `read-book` | Mark 68,000, ▼ last 67,990, the stats, and an order book with depth (ask 68,010 × 1,134; bids from 67,990 × 1,492) | `final-01-trade.jpg` |
| Allow `read-trades` | ▲ 買い / ▼ 売り rows with price, quantity and block height | `ui-12-trades.jpg` |
| Allow `read-candles-10` | 7 real devnet candles and volume; 「ノードに古いブロックがないため 7 本です」 | `final-02-chart.jpg` |
| Order ticket | Estimate 68,010 → margin 1,701 (2.50%) and fee 24 (0.035%); without a key, a warning replaces the submit button | `ui-13-ticket.jpg` |
| Account, create key | The emulator WebView (Chromium 124) has no Ed25519 in WebCrypto, so 「鍵を作れませんでした」 is shown and nothing is sent | `ui-08-account.jpg` |
| Dark mode | Every token switches; buy/sell stay readable | `final-03-trade-dark.jpg`, `final-04-ticket-dark.jpg` |

## Differences from the Figma proposal

- **No leverage slider.** The engine's order transaction has no leverage field. The ticket shows the initial margin rate instead.
- **Two order types:** limit and IOC (flags 0 and 1). The engine also accepts maker-only and reduce-only, but the ticket does not show them.
- **Quantity shortcuts are lot counts** (1/2/5/10) rather than percentages, because the percentages would need free collateral that has not been read yet.
- **Chart data is real.** The devnet has only 7 candles between 67,990 and 68,010; the Figma frames used an illustrative series.
- **Account values only appear after 口座を取得.** No open-orders list exists on the node, so cancel-all is the only cancel.

## Not verified

- **Signing and sending:** an order, the devnet faucet and cancel-all were not signed or sent, because this emulator cannot create an Ed25519 key. The code paths are unchanged from AWAI-491 apart from automatically reading head and account first.
- **The stale-height and order accepted/rejected banners** were not exercised on the device. They are driven by data the node did not produce during this run.
- **Physical device, English copy and tablet width** were not checked.
