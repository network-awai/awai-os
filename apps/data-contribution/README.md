# Data Contributions — contribute training data with rights, consent and withdrawal

A participant contributes an image, video, text document or post as LLM training data, declares the rights and the contributor shares, gives consent for that one contribution, can withdraw it, and sees the test-stage reward results. Built as static Web files or a Tauri **3.0.0-alpha.6** app (explicit `tauri-runtime-wry` v3, OS WebView), from the same layout as `apps/payment-drafts` and `apps/horei`. Tracking: [AWAI-3209](https://linear.app/kotobalabs/issue/AWAI-3209) (parent [AWAI-3206](https://linear.app/kotobalabs/issue/AWAI-3206)).

The rules are cloud-murakumo-api ADR-261118 (`training-contribution-rights`, [AWAI-3210](https://linear.app/kotobalabs/issue/AWAI-3210)) and ADR-261016. The paired itonami bot profile is `awai-data-contribution-rewards` in cloud-itonami/itonami-agent ([AWAI-3208](https://linear.app/kotobalabs/issue/AWAI-3208)); its test-stage results are what the Rewards screen reads.

## What it does

- **Contribute:** choose the kind and a file (up to 16 MiB, one block). The app computes the sha256 and the CIDv1 (raw, sha2-256) on the device. The participant declares the rights basis (`own-work` or `third-party-licensed` with a license-grant CID), a license (`USER-TRAINING-GRANT-v1`, `CC0-1.0`, `CC-BY-4.0`, `CC-BY-SA-4.0`), 1–32 contributors with DIDs and integer shares that sum to exactly 10,000 bps, the people depicted with one distinct consent CID each, and explicitly that there is no personal or sensitive data. Consent `training-data-consent/1` is given for this contribution. The checks mirror `record-decision`; a contribution without a rights basis cannot be saved.
- **Rights statement:** saving builds the participant's rights statement as canonical JSON bytes. Its sha256 and raw CID go into the record. On the device, the content bytes and the statement are kept in the app-private Awai FS block store (`src-tauri/src/awai_fs.rs`, the Horei design: every put and get rechecks the CID). The web version keeps no bytes.
- **Contributions:** each is `draft`, `submitted` or `withdrawn`. **Send** runs the one declared external operation through the canonical broker. The consent dialog shows the service, endpoint, method, path and data categories, and **denying sends no request**. Only a 2xx response marks a contribution as sent. **Withdraw** takes a second tap within 5 seconds and is recorded at once: training rounds that start later must not use the item. Earlier allocations stand. Telling the server is a planned operation.
- **Rewards (test stage):** paste an `awai.training-reward-result/1` EDN that the bot wrote. It is loaded only when it says `:payout? false`, is a successful calculation, and its allocations plus the unallocated units equal the pool. It is shown as "test stage, not paid". Nothing is fetched or paid.
- **Stored-data protection, as in Payment Drafts:** if the stored state cannot be read, saving, sending, withdrawing and loading are turned off so it is not overwritten.
- UI text is keyed in `src/messages.js` (ja, en).

The app never sets a `-verified?` or `-reviewed?` marker. The server reads the statement and consents back and decides.

## External operations

| Operation | Endpoint | State |
|---|---|---|
| `murakumo.training` / `submit-contribution` | `POST https://api.murakumo.cloud/training/contributions` | Declared, `each-operation` consent |
| Upload the content to Yataverse (Awai FS) | `https://yataverse.com` | Planned, not declared |
| Register as a contributor (bearer session) | `https://api.murakumo.cloud` | Planned, not declared |
| Tell the server about a withdrawal | `https://api.murakumo.cloud` | Planned, not declared |
| Read reward results from the server | `https://api.murakumo.cloud` | Planned, not declared; production payout is off (ADR-261016) |

The CSP `connect-src` in `index.html` and `tauri.conf.json` is checked against the descriptor at build time. The request body carries the fields the current route reads (`cid`, `license`, `rightsConfirmed`, `sensitiveData`, `consentVersion`, `assetType`, `contributorDid`, `shareBps`) and the v1 record as `rightsRecord`. It carries no credential.

The route is in cloud-murakumo-api's source but **not served in production** (`/training/*` answers 404). It needs a registered human bearer session and an asset manifest, and it does not read `rightsRecord` yet; wiring the v1 record is the AWAI-3210 follow-up. A real send from this version therefore cannot be accepted. The point of this unit is the consent gate and the request shape.

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

- `awai_fs_put` accepts the block as a raw body (desktop) or a JSON array of byte values (the Android IPC delivers a `Uint8Array` that way, measured on the API 35 emulator); anything else is refused.
- The Android manifest has `INTERNET` for the one consented operation. The Tauri host exposes `awai_host_info`, `awai_fs_get` and `awai_fs_put` only: no network, installer, signing or shell commands.
- No payout, mint, claim, signature or upload. Rewards are display-only test-stage data.
- Icons in `src-tauri/icons` and the Android launcher mipmaps were generated from `icon.svg` with `npx tauri icon icon.svg`.

## Qualification

Evidence: [`docs/evidence/data-contribution-awai3209-20261118/`](../../docs/evidence/data-contribution-awai3209-20261118/README.md). There is no CI job that builds the Tauri apps in this repository. Release signing, Itonami Store distribution and `dapps.json` (AWAI-3211), physical devices, Figma design review and TalkBack testing remain open.
