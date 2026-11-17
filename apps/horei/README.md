# Horei — offline law browser

Search Japan's laws, open a law's details, and follow its amendment history, all on the device. Built as static Web files or a Tauri **3.0.0-alpha.6** app (explicit `tauri-runtime-wry` v3, OS WebView), from the same layout as `apps/yotei`. Tracking: [AWAI-3134](https://linear.app/kotobalabs/issue/AWAI-3134) (parent [AWAI-3132](https://linear.app/kotobalabs/issue/AWAI-3132)).

## What it contains

| Data | Count | Source |
|---|---|---|
| Japanese laws (metadata and full-text address) | 9,536 | e-Gov law data via `kotoba-lang/app-itonami-global-legislation-datoms` |
| Amendment links | 7,793 | same |
| Jurisdiction catalog (legislatures, courts, primary sources) | 568 entities, 198 jurisdictions | same |

`data/PROVENANCE.json` records the source commit, the sha256 of every input shard and every output file. The build refuses data whose bytes differ from it. **No full text is bundled** (`fullTextBytesHeld: 0`). Each law carries the sha256 and size of its text. Fetching it from Yataverse is [AWAI-3137](https://linear.app/kotobalabs/issue/AWAI-3137).

Only Japan has a list of laws. The other jurisdictions show catalog entries only. EU, UK and US corpora exist upstream and are not imported here.

## Build

```sh
(cd ../../packages/awai-ui && npm ci && npm run build)   # shared UI, once per checkout
npm ci
npm test
npm run build                  # dist/: static files, each pinned in release.json
npm run build:android          # arm64 APK; JDK21, SDK 37, NDK 27.0.12077973
```

Debug APK for an emulator: `npx tauri android build --debug --apk --target aarch64`.

## Refresh the data

```sh
node scripts/import-corpus.mjs <clean checkout of app-itonami-global-legislation-datoms> [dataset]
```

The import checks each shard against `data/corpus/manifest.edn`, refuses a dirty checkout, and fails rather than guessing on anything the EDN reader (`scripts/edn.mjs`) does not understand. Both ends of an amendment link may lie outside the corpus (for example an amending act that is not itself in it). Those ends are kept as their key, not dropped.

## Boundaries

- The descriptor (`kotoba.app.client-runtime.v1`) declares **no external operations**. The page CSP allows only `'self'` scripts/styles and the Tauri IPC. The data is packaged as ES modules, so the page makes no fetch of its own.
- The Tauri host exposes one command (`awai_host_info`). No network, filesystem, installer or shell permissions. No state is persisted (`local-state: memory`).
- UI text is keyed in `src/messages.js` (ja, en). Law titles, numbers and categories are source data and stay in Japanese.

## Known data gaps (upstream)

- Some current laws are present only as an earlier revision: 民法 and 会社法 are marked `superseded-revision`, and no in-force row exists for them. The app shows the status as recorded.
- Five amendment links name the amending act as `000000000000000` with no law number. The app shows "No record of the amending law".

## Not yet qualified

Static build, unit tests and a debug APK on an Android emulator are this unit's evidence. Release signing, Awai OS store distribution ([AWAI-3138](https://linear.app/kotobalabs/issue/AWAI-3138)), physical devices, Figma design review and TalkBack testing remain open.
