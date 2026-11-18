# Public Funds — see where public money was planned to go and where it went

View, on the device, the **awai.public-funds/1** records that the `awai-public-funds` itonami bot profile writes from public government budget data: the flow from each ministry (所管) to the UN COFOG divisions, initial budget against outturn, the outturn's arithmetic checks, and the sources with their sha256. Built as static Web files or a Tauri **3.0.0-alpha.6** app (explicit `tauri-runtime-wry` v3, OS WebView), from the same layout as `apps/securities-drafts`, `apps/payment-drafts` and `apps/x402`. Tracking: [AWAI-3296](https://linear.app/kotobalabs/issue/AWAI-3296) (parent [AWAI-3291](https://linear.app/kotobalabs/issue/AWAI-3291)); scope: network-awai-apex ADR 0046 (D3, D7, D8). The paired bot profile is `awai-public-funds` in kotoba-lang/itonami-agent ([AWAI-3294](https://linear.app/kotobalabs/issue/AWAI-3294)).

Design: [Figma proposal, page "Public Funds · Awai UI · AWAI-3296"](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=305-1832) in the Awai Android Native UX v2 file, built from its Android v2 components and variables.

## What it does

- **Import:** choose or paste the `.result.edn` the bot wrote. The app reads a strict EDN subset (maps, vectors, strings, keywords, integers, `true`/`false`/`nil`; nothing else) and accepts the record only when its shape is right, every source has an `https` URL, a sha256 the bot verified and a fetch time, and the totals equal the rows they summarise. A bot refusal is recognised and not imported.
- **Flow:** ministry → COFOG division for the amount spent or the initial budget. The eight largest ministries are drawn; the rest are one group. The table under "Show as a table" lists every row of the record.
- **Budget and outturn:** totals, the outturn's two identity checks, one line per fiscal year imported, and each ministry's initial budget, spending and difference.
- **Sources:** each source's title, publisher, URL, full sha256, archive sha256, fetch time and terms; the COFOG mapping version and the codes the bot left unmapped; the notes the bot recorded.
- Every amount keeps its basis: sums are **derived**, the COFOG division is the bot's **assumption**, and reserves, disaster spending and unspecified items stay **unmapped** instead of being spread over divisions. A difference is shown without a cause. Nothing is ranked or judged.
- **Stored-data protection, as in Securities Drafts:** unreadable stored results make the app read-only; a conflicting write re-reads first; up to four results are kept.

## Build

```sh
(cd ../../packages/awai-ui && npm ci && npm run build)   # shared UI, once per checkout
npm ci
npm test
npm run build                  # dist/: static files, each pinned in release.json
npm run build:android          # arm64 APK; JDK21, SDK 37, NDK 27.0.12077973
```

## Boundaries

- The descriptor (`kotoba.app.client-runtime.v1`) declares **no external operations**. The page CSP allows only `'self'` scripts/styles and the Tauri IPC. Nothing is fetched from a publisher, published or sent; the file picker reads a file the user chose.
- Fetching from a publisher (ADR 0046 O1), publishing results (O2) and receiving from the bot are listed in `src/model.js` `PLANNED_OPERATIONS` for display only.
- The Tauri host exposes one command (`awai_host_info`).
- UI text is keyed in `src/messages.js` (ja, en). Ministry names and source titles are record data and are shown as they are.

## Qualification

Source, unit tests, the static build and a browser walk-through: [`docs/evidence/public-funds-awai3296-20261118/`](../../docs/evidence/public-funds-awai3296-20261118/README.md). The Android APK on the API 35 VM and on a device running Awai OS is [AWAI-3297](https://linear.app/kotobalabs/issue/AWAI-3297). There is no CI job that builds the Tauri apps in this repository.
