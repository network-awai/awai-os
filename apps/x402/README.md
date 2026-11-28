# x402 Pay — x402 payment request drafts

Draft, on the device, the HTTP 402 payment terms an x402 seller returns, in the wire shape that [network-awai/nexus-x402](https://github.com/network-awai/nexus-x402) uses (`PaymentRequirements`: `scheme: "transaction"`, `network`, `payTo`, `maxAmountRequired` in USDC base units, `asset`). Built as static Web files or a Tauri **3.0.0-alpha.6** app (explicit `tauri-runtime-wry` v3, OS WebView), from the same layout as `apps/horei`. Tracking: [AWAI-3252](https://linear.app/kotobalabs/issue/AWAI-3252) (parent [AWAI-454](https://linear.app/kotobalabs/issue/AWAI-454)). The paired itonami bot profile is `awai-growth-x402-adoption` in kotoba-lang/itonami-agent ([AWAI-3251](https://linear.app/kotobalabs/issue/AWAI-3251)).

The app lives here, next to the other Awai OS apps, rather than in nexus-x402: it shares `packages/awai-shell`, `packages/awai-ui`, the pinned canonical client runtime in `otehon/shell/vendor` and the Android build layout. nexus-x402 stays the source of the wire format and of the facilitator.

## What it does

- Validates an amount (USD, at most 6 decimals, at most USD 1,000), a receiving address and a resource (`/path` or an `https` URL), and shows the `{"x402Version":1,"accepts":[…]}` body a seller would return.
- **Base Sepolia only** (chain 84532, USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, the value in nexus-x402 `src/nexus/cctp.cljk`). Base mainnet is refused by the model.
- Saves up to 50 drafts through the Awai Shell host (`localStorage`, app-scoped, revisioned). Drafts can be copied as JSON or deleted; deletion is two-step (a second tap within 5 s), because a deleted draft cannot be restored.
- Stored drafts that cannot be read (wrong schema, an invalid requirement, more than 50, duplicate ids) are never truncated or overwritten: the app goes read-only and says so on every view. A revision conflict, or the draft limit after another window changed the drafts, re-reads the stored drafts and asks the user to try again.
- The Android system bars follow the light/dark theme, also on a live switch. A locale change recreates the activity; runtimes that change language without a reload re-render on `languagechange`.

## Build

```sh
(cd ../../packages/awai-ui && npm ci && npm run build)   # shared UI, once per checkout
npm ci
npm test
npm run build                  # dist/: static files, each pinned in release.json
npm run build:android          # universal ARM64 + x86_64 APK; JDK 21, SDK 37, NDK 27.0.12077973
npm run check:android -- src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
```

Debug APK for an emulator: `npx tauri android build --debug --apk --target aarch64`.

Run the APK check on the release artifact before handing it to the signer and again on the signed output. It records the size, SHA-256, package, version and both ABIs. It also checks the 16 KiB ELF and ZIP alignment, release manifest, and absence of the Android INTERNET permission. The signer identity and install/update behavior have their own QA steps.

## Boundaries

- The descriptor (`kotoba.app.client-runtime.v1`) declares **no external operations**. The page CSP allows only `'self'` scripts/styles and the Tauri IPC. Nothing is fetched, sent, signed or settled.
- The three operations a later version needs (receive a 402 challenge from a seller, sign in the user's own wallet, verify and settle with the x402.nexus facilitator) are listed in `src/model.js` `PLANNED_OPERATIONS` for display only. Each needs a declared endpoint, method and path and per-operation consent through the canonical broker before it can run.
- The Tauri host exposes one command (`awai_host_info`). No network, wallet, signing, filesystem, installer or shell permissions.
- UI text is keyed in `src/messages.js` (ja, en).

## Not yet qualified

AWAI-3252 checked a debug APK on an API 35 VM (`docs/evidence/x402-awai3252-20261118`). AWAI-3890 recorded launch, draft retention, limit feedback and system bars on the ARM64 moto g05 (`docs/evidence/x402-20261125`). The release APK still needs x86_64 device or VM qualification, release signing and signed Store delivery. Figma review and TalkBack testing remain open. Icons in `src-tauri/icons` and the Android launcher mipmaps were generated from `icon.svg` with `npx tauri icon icon.svg`.
