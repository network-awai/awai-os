# x402 Pay — x402 payment request drafts

Draft, on the device, the HTTP 402 payment terms an x402 seller returns, in the wire shape that [network-awai/nexus-x402](https://github.com/network-awai/nexus-x402) uses (`PaymentRequirements`: `scheme: "transaction"`, `network`, `payTo`, `maxAmountRequired` in USDC base units, `asset`). Built as static Web files or a Tauri **3.0.0-alpha.6** app (explicit `tauri-runtime-wry` v3, OS WebView), from the same layout as `apps/horei`. Tracking: [AWAI-3252](https://linear.app/kotobalabs/issue/AWAI-3252) (parent [AWAI-454](https://linear.app/kotobalabs/issue/AWAI-454)). The paired itonami bot profile is `awai-growth-x402-adoption` in kotoba-lang/itonami-agent ([AWAI-3251](https://linear.app/kotobalabs/issue/AWAI-3251)).

The app lives here, next to the other Awai OS apps, rather than in nexus-x402: it shares `packages/awai-shell`, `packages/awai-ui`, the pinned canonical client runtime in `otehon/shell/vendor` and the Android build layout. nexus-x402 stays the source of the wire format and of the facilitator.

## What it does

- Validates an amount (USD, at most 6 decimals, at most USD 1,000), a receiving address and a resource (`/path` or an `https` URL), and shows the `{"x402Version":1,"accepts":[…]}` body a seller would return.
- **Base Sepolia only** (chain 84532, USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, the value in nexus-x402 `src/nexus/cctp.cljk`). Base mainnet is refused by the model.
- Saves up to 50 drafts through the Awai Shell host (`localStorage`, app-scoped, revisioned). Drafts can be copied as JSON or deleted.

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

- The descriptor (`kotoba.app.client-runtime.v1`) declares **no external operations**. The page CSP allows only `'self'` scripts/styles and the Tauri IPC. Nothing is fetched, sent, signed or settled.
- The three operations a later version needs (receive a 402 challenge from a seller, sign in the user's own wallet, verify and settle with the x402.nexus facilitator) are listed in `src/model.js` `PLANNED_OPERATIONS` for display only. Each needs a declared endpoint, method and path and per-operation consent through the canonical broker before it can run.
- The Tauri host exposes one command (`awai_host_info`). No network, wallet, signing, filesystem, installer or shell permissions.
- UI text is keyed in `src/messages.js` (ja, en).

## Not yet qualified

Source, unit tests and the static build are this unit's evidence. The debug APK build and the API35 Android VM launch were not run (host load); they, release signing, Itonami Store distribution, physical devices, Figma design review and TalkBack testing remain open. Icons in `src-tauri/icons` and the Android launcher mipmaps were generated from `icon.svg` with `npx tauri icon icon.svg`.
