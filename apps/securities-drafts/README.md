# Securities Drafts — local drafts of your own settlement instructions and holdings checks

Draft and check, on the device, the ISO 20022 **sese.023.001.09** settlement instruction for the account holder's own securities account; import the custodian's **semt.002.001.10** custody statement and compare it with the positions you keep yourself. Built as static Web files or a Tauri **3.0.0-alpha.6** app (explicit `tauri-runtime-wry` v3, OS WebView), from the same layout as `apps/payment-drafts`, `apps/x402` and `apps/isekai`. Tracking: [AWAI-3158](https://linear.app/kotobalabs/issue/AWAI-3158) (parent [AWAI-3149](https://linear.app/kotobalabs/issue/AWAI-3149)); scope: network-awai-apex ADR 0042 (D1–D6). The paired itonami bot profile is `awai-securities-ops` in kotoba-lang/itonami-agent ([AWAI-3156](https://linear.app/kotobalabs/issue/AWAI-3156)).

## What it does

- **New instruction:** reference, receive or deliver, free or against payment, settlement date, ISIN (shape and ISO 6166 check digit), optional description, unit quantity, safekeeping account, transaction type, place of settlement and the counterparty's agent (BIC), and for against payment the currency and amount. Values are checked against the XSD facets; the preview shows the XML and the L1 checks.
- **The XML is the element subset that kotoba-lang/kotoba `lib/kotoba.swift` (`kotoba.swift.securities`) emits, byte for byte.** `test/fixtures` holds the awai-securities-ops fixtures; the tests build the same bytes from the same fields.
- **Import:** paste a sese.023.001.09 instruction (for example one the awai-securities-ops bot drafted) or a semt.002.001.10 statement. It is imported only when it is exactly what this app builds from the same values, and every value passes the checks.
- **Holdings:** pick an imported statement, enter your positions (`ISIN quantity` per line, a minus sign for a short position) and compare. The lines are the same as the bot profile's `:reconcile-holdings` (match, quantity differs, not in the statement, not in your record; decimals compared in canonical form).
- **Saved items:** instructions and statements are `draft` or `approved`. Approving records that you reviewed it; it sends, orders or moves nothing. Deleting takes a second tap within 5 seconds.
- **Stored-data protection, as in payment-drafts, Isekai and x402:** unreadable stored items (bad schema or body, unknown kind or status, more than 50, duplicate ids) make the app read-only; a conflicting write re-reads first; the limit is reported after a re-read.

Only ADR 0042 level **L1** is checked. **L2** (market practice) and **L3** (acceptance by a custodian or settlement system) wait on O3 and O5. Other people's accounts are out of scope (O1). Ordering is not a feature of this app.

## Build

```sh
(cd ../../packages/awai-ui && npm ci && npm run build)   # shared UI, once per checkout
npm ci
npm test
npm run build                  # dist/: static files, each pinned in release.json
npm run build:android          # arm64 APK; JDK21, SDK 37, NDK 27.0.12077973
```

## Boundaries

- The descriptor (`kotoba.app.client-runtime.v1`) declares **no external operations**. The page CSP allows only `'self'` scripts/styles and the Tauri IPC. Nothing is fetched, sent to a custodian, signed, ordered or paid.
- The Android manifest has no `INTERNET` permission.
- Three later operations (send the instruction to your own custodian; receive statements and confirmations from it; receive drafts from your own awai-securities-ops bot) are listed in `src/model.js` `PLANNED_OPERATIONS` for display only, with what each waits on.
- The Tauri host exposes one command (`awai_host_info`).
- UI text is keyed in `src/messages.js` (ja, en). Not investment advice.

## Qualification

Source, unit tests, the static build and a browser walk-through: [`docs/evidence/securities-drafts-awai3158-20261118/`](../../docs/evidence/securities-drafts-awai3158-20261118/README.md). The debug APK on the API 35 Android VM (AWAI-3285: no `INTERNET`, no traffic from the app's UID for 60 s after a cold start, sese.023 with L1 pass, semt.002 import and the holdings check, approval, read-only on unreadable storage): [`apk-vm/`](../../docs/evidence/securities-drafts-awai3158-20261118/apk-vm/README.md). There is no CI job that builds the Tauri apps in this repository. Icons were generated from `icon.svg` with `npx tauri icon icon.svg`.
