# Isekai Fork — local drafts of Isekai game-fork commits

Draft, on the device, the commit an [Isekai Network](https://isekai.network/) game fork records, in the shape that [network-awai/network-isekai](https://github.com/network-awai/network-isekai) `src/isekai/fork_git.cljk` (`commit-fork`) uses: `parents` (the parent fork commit CID, or none for the first version of a game), `author` (the creator's `did:key`) and `message`. Built as static Web files or a Tauri **3.0.0-alpha.6** app (explicit `tauri-runtime-wry` v3, OS WebView), from the same layout as `apps/x402` and `apps/horei`. Tracking: [AWAI-3216](https://linear.app/kotobalabs/issue/AWAI-3216) (parent [AWAI-454](https://linear.app/kotobalabs/issue/AWAI-454)). The paired itonami bot profile is `awai-growth-isekai-adoption` in kotoba-lang/itonami-agent ([AWAI-3215](https://linear.app/kotobalabs/issue/AWAI-3215)).

The app lives here, next to the other Awai OS apps, rather than in network-isekai: it shares `packages/awai-shell`, `packages/awai-ui`, the pinned canonical client runtime in `otehon/shell/vendor` and the Android build layout. network-isekai stays the source of the fork format, the browser site and the ledger.

## What it does

- Validates the game (lowercase letters, digits, hyphens), an optional parent fork CID (a decoded CIDv1 in base32 with a sha2-256 digest) and the author's `did:key` (an ed25519, secp256k1 or P-256 public key that decodes to a point on its curve), plus a description of the change, and shows the commit draft.
- If the stored drafts cannot be read, the app shows that and turns off saving and deleting so they are not overwritten. A save that conflicts with another window re-reads the stored drafts first.
- A draft has no tree and no commit CID: those are computed when a fork is published, which this version does not do. Every draft is `moderation: "pending"`, `published: false`.
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

- The descriptor (`kotoba.app.client-runtime.v1`) declares **no external operations**. The page CSP allows only `'self'` scripts/styles and the Tauri IPC. Nothing is fetched, published, signed, paid or minted.
- The Android manifest has no `INTERNET` permission.
- The three operations a later version needs (publish the fork to the kotoba-git ledger on kotobase, pay the fork fee with x402, mint a gem) are listed in `src/model.js` `PLANNED_OPERATIONS` for display only. Each needs a declared endpoint, method and path and per-operation consent through the canonical broker before it can run.
- The Tauri host exposes one command (`awai_host_info`). No network, publishing, payment, filesystem, installer or shell permissions.
- UI text is keyed in `src/messages.js` (ja, en).

## Qualification

Source, unit tests, the static build, a debug APK and its launch on the API 35 Android VM are this unit's evidence: [`docs/evidence/isekai-awai3216-20261118/`](../../docs/evidence/isekai-awai3216-20261118/README.md). On a freshly wiped device the system WebView service fetched its variations seed once on the app's first launch (its own UID, not the app's); that record is there too. The re-check after the review fixes (stale or unreadable stored drafts, the draft limit, CID and did:key decoding, theme-aware system bars) is in [`recheck/`](../../docs/evidence/isekai-awai3216-20261118/recheck/README.md). The second review round (over-limit stored state, curve-point and varint checks, input length, locale changes) is in [`recheck2/`](../../docs/evidence/isekai-awai3216-20261118/recheck2/README.md); the third round (duplicate ids, low-order Ed25519 keys, locale recreation) is in [`recheck3/`](../../docs/evidence/isekai-awai3216-20261118/recheck3/README.md). On Android a language change recreates the activity and reloads the page, so unsaved form input is lost. Release signing, Itonami Store distribution, physical devices, Figma design review and TalkBack testing remain open. Icons in `src-tauri/icons` and the Android launcher mipmaps were generated from `icon.svg` with `npx tauri icon icon.svg`.
