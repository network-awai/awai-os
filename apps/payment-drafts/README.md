# Payment Drafts — local drafts of your own pain.001 payment instructions

Draft and check, on the device, the ISO 20022 **pain.001.001.09** payment instruction for the account holder's own transfer, then keep it locally for review. Built as static Web files or a Tauri **3.0.0-alpha.6** app (explicit `tauri-runtime-wry` v3, OS WebView), from the same layout as `apps/x402` and `apps/isekai`. Tracking: [AWAI-3157](https://linear.app/kotobalabs/issue/AWAI-3157) (parent [AWAI-3149](https://linear.app/kotobalabs/issue/AWAI-3149)); scope: network-awai-apex ADR 0042 (D1–D6). The paired itonami bot profile is `awai-banking-ops` in kotoba-lang/itonami-agent ([AWAI-3155](https://linear.app/kotobalabs/issue/AWAI-3155)).

The app replaces the Cloudflare Worker appview `network-awai/app-itonami-open-swift` (see "Migration inventory"). The user-facing name does not use "SWIFT", a trademark of S.W.I.F.T. SC (ADR 0042 O4).

## What it does

- **New draft:** your name, IBAN and BIC; the payee's name, IBAN and BIC; amount, currency, requested execution date, charges, an End-to-End reference and optional instruction reference, UETR and purpose. Every value is checked against the XSD facets of pain.001.001.09 (lengths, BIC and IBAN patterns, IBAN check digits, calendar dates, lowercase UUIDv4 UETR, amount digits). The preview shows the XML and the L1 checks.
- **The XML is the element subset that kotoba-lang/kotoba `lib/kotoba.swift` emits, byte for byte.** `test/fixtures` holds the awai-banking-ops profile's fixture (built by kotoba.swift and validated against the pinned XSD); the tests build the same bytes from the same fields.
- **Import:** paste pain.001.001.09 XML, for example a draft the awai-banking-ops bot wrote to its workspace. It is imported only when it is exactly what this app builds from the same fields, and every value passes the L1 checks: other elements, a total that does not match, whitespace around a value, a DOCTYPE, comments or unknown entities are refused.
- **Drafts:** each draft is `draft` or `approved`. Approving records that you reviewed it; it sends nothing. Copy the XML to send it through your own bank. Deleting takes a second tap within 5 seconds.
- **Stored-data protection, as in Isekai and x402:** if the stored drafts cannot be read (bad schema or instruction, an unknown status, more than 50 drafts, duplicate ids), the app says so and turns off saving, importing, approving and deleting so they are not overwritten. A write that conflicts with another window re-reads first; the draft limit is reported after a re-read.
- Saves up to 50 drafts through the Awai Shell host (`localStorage`, app-scoped, revisioned).

Only ADR 0042 level **L1** (syntax of the modeled subset) is checked. **L2** (usage guidelines such as CBPR+) and **L3** (acceptance by a bank) are not; they wait on the owner decisions O3 and O5, and the app says so with every check. Other people's transactions are out of scope (O1).

## Build

```sh
(cd ../../packages/awai-ui && npm ci && npm run build)   # shared UI, once per checkout
npm ci
npm test
npm run build                  # dist/: static files, each pinned in release.json
npm run build:android          # arm64 APK; JDK21, SDK 37, NDK 27.0.12077973
```

Debug APK for an emulator: `npx tauri android build --debug --apk --target aarch64`.

## Boundaries

- The descriptor (`kotoba.app.client-runtime.v1`) declares **no external operations**. The page CSP allows only `'self'` scripts/styles and the Tauri IPC (`connect-src ipc: http://ipc.localhost`). Nothing is fetched, sent to a bank, signed or paid.
- The Android manifest has no `INTERNET` permission.
- The three operations a later version may need (send the instruction to your own bank, receive statements from it, receive drafts from your own awai-banking-ops bot) are listed in `src/model.js` `PLANNED_OPERATIONS` for display only, with what each waits on. Each needs an owner decision, a declared endpoint, method and path, and per-operation consent through the canonical broker before it can run.
- The Tauri host exposes one command (`awai_host_info`). No network, bank, signing, filesystem, installer or shell permissions.
- UI text is keyed in `src/messages.js` (ja, en).

## Migration inventory: app-itonami-open-swift

The Worker appview `network-awai/app-itonami-open-swift` (`etzhayyim-open-swift`, route `open-swift.etzhayyim.com/*`) answered:

| Route | What it did | Here |
|---|---|---|
| `GET /` | Description page of the appview | Replaced by this app's static pages |
| `GET /health` | Liveness JSON | Not needed: no app-origin handler |
| `POST /xrpc/:nsid` | Relayed XRPC calls to the MCP router | Not carried over: an app origin may not proxy (ADR 0015, shared contract) |

The Worker and its route are untouched. Stopping or redirecting them is a separate, approved cutover.

## Qualification

Source, unit tests, the static build and a browser walk-through are this unit's evidence: [`docs/evidence/payment-drafts-awai3157-20261118/`](../../docs/evidence/payment-drafts-awai3157-20261118/README.md). The debug APK on the API 35 Android VM (AWAI-3285: no `INTERNET`, no traffic from the app's UID for 60 s after a cold start, draft with L1 pass, approval, read-only on unreadable storage): [`apk-vm/`](../../docs/evidence/payment-drafts-awai3157-20261118/apk-vm/README.md). There is no CI job that builds the Tauri apps in this repository (the same holds for x402 and Isekai). Release signing, Itonami Store distribution, physical devices, Figma design review and TalkBack testing remain open. Icons in `src-tauri/icons` and the Android launcher mipmaps were generated from `icon.svg` with `npx tauri icon icon.svg`.
