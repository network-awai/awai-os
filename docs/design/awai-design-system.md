# Awai design system: shared rules for Awai OS and Itonami apps

Owner request: 2026-11-18. Tracking: [AWAI-3402](https://linear.app/kotobalabs/issue/AWAI-3402). It applies to Awai OS (Android AOSP and desktop) and to the Itonami apps (Torihiki, Torihiki Bot, Rodo, Yotei, the Store and others).

This document collects the rules spread across [interface-principles.md](interface-principles.md), the [Figma design-first contract](../otehon/design-first.md) and the workspace architecture contract into one design system, and links the Figma source.

- **Precedence:** the architecture, authorization and consent contract in the workspace `AGENTS.md` still governs.
- **Source of truth:** Figma is the source of truth for screen composition, and code is the source of truth for implemented behavior. Report any difference between them; do not silently make one match the other.

## Figma

File: `umqCqP5KSjLWh9fhCI1HaN`. The Otehon baseline (`215:2`, `216:475`/`216:476`) is unchanged.

| What | Node |
| -- | -- |
| Design system page | [311:1994](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=311-1994) |
| Rules and foundations (light/dark swatches, type ramp, spacing) | [313:32](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=313-32) |
| Components | [312:2](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=312-2) |
| Torihiki trade UX proposal | [315:2](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=315-2) |

## Rules

1. **Source of truth.**
   - Figma owns composition; code owns behavior.
   - A proposal goes next to the baseline and never edits it.
   - Changing navigation, the shell or the visual identity needs an owner design decision.
2. **Runs on the device.**
   - UI, state and logic run in the browser or on the device.
   - The app origin only serves static files: no BFF and no per-user server state.
3. **Consent for each external operation.**
   - Only the canonical `kotoba-client-runtime` consent host asks for approval. `DS / Consent sheet` is a visual reference for it, not an implementation.
   - Show that a denial sent nothing.
   - Apps never draw their own approval button, batch approvals or remember approvals.
4. **Honest state.**
   - Loading, empty, denied, error (with retry), stale and unknown are distinct states.
   - Never show a value that was not fetched.
   - Show when values were last fetched, and say that they do not refresh automatically.
5. **Never color alone.**
   - Buy/up is `market/up` with ▲ and the word 買い; sell/down is `market/down` with ▼ and 売り.
   - Text contrast is at least 4.5:1.
6. **Numbers.**
   - Use thousands separators, right-align numbers and state the unit.
   - Integers from the node are labeled 生値 (raw values) and are never presented as a currency.
7. **Actions.**
   - Touch targets are at least 48dp, and primary actions sit at the bottom where the thumb reaches.
   - Orders, transfers and deletions use the destructive style or a confirmation, and say what cannot be undone.
8. **Demo versus real assets.**
   - A chip always shows devnet or demo status.
   - Nothing pretends to be production or real money.
   - Signing uses the device key, and the private key never leaves the device.
9. **Type and language.**
   - Typeface: Noto Sans JP, with body 16, label 14 and caption 12.
   - At 200% text size, text wraps and the screen scrolls vertically.
   - Japanese and English messages are complete sentences with named placeholders.
10. **Tokens.**
    - Colors come only from the `android/*` semantic variables (Light/Dark) and the new `market/*` and `status/*` variables.
    - Spacing is 4/8/16/24/32/48, radius is 8/12/16/28/999 and the minimum target is 48.
    - No hard-coded values.
11. **Navigation.**
    - Keep the OS Core/Apps/System structure and the shell unchanged.
    - Inside an app, use 3–5 bottom tabs. Back is always top-left and the OS back gesture.
12. **Motion.**
    - Respect reduced motion.
    - A price change shows once as color plus an arrow, never as blinking.

## Tokens

| Collection | Modes | Contents |
| -- | -- | -- |
| Awai Android v2 · semantic (existing) | Light, Dark | `android/background`, `surface`, `text`, `muted`, `primary`, `onPrimary`, `container`, `onContainer`, `border`, `error`, `errorContainer` |
| Awai DS · market & status (new, `VariableCollectionId:311:1995`) | Light, Dark | `market/up` `#0f7a55`/`#5fd3a4`, `market/up-container`, `market/down` `#bc002d`/`#ff8fa6` (brand red), `market/down-container`, `market/grid`, `market/neutral`, `status/warning`, `status/warning-container`, `status/info-container`, `status/scrim` |
| Spacing, Radius (existing) | Value | `spacing/xs`–`2xl` 4–48, `radius/sm`–`full` |

## Components

The new components live on the design system page. They reuse the existing `Android v2 / Button` (Primary/Tonal/Text; Default/Pressed/Disabled/Loading/Destructive) and `Android v2 / Icon / *`.

| Component | Variants / properties | Use |
| -- | -- | -- |
| `DS / Chip` | Tone = Warning, Info, Up, Down, Neutral; Label | devnet badge, direction, short status |
| `DS / Banner` | Tone = Warning, Error, Info; Title, Body | page-level risk, error and retry, denied |
| `DS / Stat` | Label, Value | label over a numeric value |
| `DS / Segment` | State = Selected, Unselected; Label | spans, order type, tabs inside a card |
| `DS / Side toggle` | Side = Buy, Sell | order side |
| `DS / Book row` | Side = Bid, Ask; Price, Qty; resize `Depth` to cumulative/max | order book level |
| `DS / Trade row` | Side = Buy, Sell; Price, Qty, Height | recent trades |
| `DS / App bar` | Title, Subtitle, Show back | top of every app screen |
| `DS / Field` | Label, Value, Unit | numeric input |
| `DS / Consent sheet` | Service, Operation, Endpoint, Request, Data sent | canonical broker reference only |

Patterns that are drawn rather than componentized:
- **Candle chart:** wick, body, volume, last-price line and tag, right axis.
- **Bottom tabs:** the icon bound to `android/text`, with the selected tab in a `container` pill.

## Torihiki proposal (`315:2`)

The proposal does not change the Otehon shell or OS navigation. Inside the app it uses 取引, チャート and 口座 bottom tabs. It needs owner review before implementation.

**Row 1:**
- **T1 Trade:** price header, a compact chart, order book with depth, and Buy/Sell at the bottom. Light (`315:3`) and dark (`317:492`).
- **T2 Chart:** candles with volume and a span choice (`315:186`).
- **T3 Order ticket:** side, limit or market, price shortcuts, quantity percentages, leverage and an estimate (`316:285`).
- **T4 Consent:** canonical broker disclosure before `POST /tx` (`316:361`).
- **T5 Account:** equity, collateral, positions, the key card, devnet funds, and cancel-all (`316:447`).

**Row 2, states (`317:178`–`317:452`):** not yet fetched, denied, loading, error with retry, possibly stale (the height has stayed at 62), order accepted, and order rejected (`insufficient-margin`).

**Data:**
- Price, order book and node values are the devnet node's real values at 2026-11-18 13:09.
- The chart candles are illustrative, because the devnet has only 7 candles between 67,990 and 68,010.
- The account values are illustrative.

**Gaps against the node:**
- The node does not return a list of open orders, so the design only offers cancel-all.
- The liquidation price is not computed before sending.
- The fee shown uses `taker-fee-rate` 350000 read as 0.035%, which is not confirmed against the engine.

## Not done

- No implementation: the Android Torihiki client still renders the current UI.
- The design is not compared on a physical device.
- English copy is not written.
- No owner design decision has been recorded.
- The design system is not published as a Figma library.
