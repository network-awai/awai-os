# Horei — offline law browser

Search Japan's laws, open a law's details, and follow its amendment history, all on the device. Built as static Web files or a Tauri **3.0.0-alpha.6** app (explicit `tauri-runtime-wry` v3, OS WebView), from the same layout as `apps/yotei`. Tracking: [AWAI-3134](https://linear.app/kotobalabs/issue/AWAI-3134) (parent [AWAI-3132](https://linear.app/kotobalabs/issue/AWAI-3132)).

## What it contains

| Data | Count | Source |
|---|---|---|
| Japanese laws (metadata and full-text address) | 9,536 | e-Gov law data via `kotoba-lang/app-itonami-global-legislation-datoms` |
| Amendment links | 7,793 | same |
| Jurisdiction catalog (legislatures, courts, primary sources) | 568 entities, 198 jurisdictions | same |

`data/PROVENANCE.json` records the source commit, the sha256 of every input shard and every output file. The build refuses data whose bytes differ from it. **No full text is bundled** (`fullTextBytesHeld: 0`). Each law carries the sha256 and size of its text. The app can fetch that text from Awai FS (yataverse.com) on request and keep it in the device's Awai FS block store ([AWAI-3316](https://linear.app/kotobalabs/issue/AWAI-3316), [AWAI-3324](https://linear.app/kotobalabs/issue/AWAI-3324), below). Publishing all texts is [AWAI-3317](https://linear.app/kotobalabs/issue/AWAI-3317); so far one qualification text (失火責任法) is published.

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

- The descriptor (`kotoba.app.client-runtime.v1`) declares **one external operation**, `itonami.horei.fulltext` / `awai.fs` / `read-law-text`: `GET https://yataverse.com/ipfs/<cid>?format=raw` (the Awai FS bytes plane, no redirects), consent `each-operation` (`src/fulltext.js`). The build derives the CSP `connect-src` from it and refuses an `index.html` or `tauri.conf.json` that differs.
- The CID is CIDv1 (raw, sha2-256) derived from the law's `:law.text/sha256`; only that identifier is sent. Denying the consent dialog sends no request. The received bytes are shown and kept only if their size and sha256 match the law's record.
- On the device, verified texts are kept in the host's **Awai FS block store** (`src-tauri/src/awai_fs.rs`, app-private `app_data_dir/awai-fs/blocks/<cid>`). The host recomputes the CID on every put and get, refuses bytes that do not match, writes via temp file, fsync and rename, and deletes a damaged block instead of returning it. `awai_fs_put` accepts the block as a raw body (desktop) or a JSON array of byte values (how the Android IPC delivers a `Uint8Array`; before [AWAI-3353](https://linear.app/kotobalabs/issue/AWAI-3353) every put was refused on Android). A second open needs no request. The store is local to the app; it is not replicated back to yataverse.com. The Web build has no Awai FS and keeps a text only until the page is closed.
- The request has a 90 s deadline, which includes the time the consent dialog is open. A timeout is reported as "could not get the full text".
- The WebView origin is `https://tauri.localhost` (`useHttpsScheme`), the origin yataverse.com's `/ipfs` CORS allow-list names (network-awai/app-itonami-yataverse `288a8be`, AWAI-3274). Until that Worker change is deployed, the WebView cannot read the response ([AWAI-3325](https://linear.app/kotobalabs/issue/AWAI-3325)).
- The Tauri host exposes `awai_host_info` and `awai_fs_get` / `awai_fs_put` / `awai_fs_delete`. No network, installer or shell commands. The Android manifest has `INTERNET` for the WebView request.
- UI text is keyed in `src/messages.js` (ja, en). Law titles, numbers and categories are source data and stay in Japanese.

## Known data gaps (upstream)

- Some current laws are present only as an earlier revision: 民法 and 会社法 are marked `superseded-revision`, and no in-force row exists for them. The app shows the status as recorded.
- Five amendment links name the amending act as `000000000000000` with no law number. The app shows "No record of the amending law".

## Not yet qualified

Static build, unit tests and a debug APK on an Android emulator are this unit's evidence. Release signing, Awai OS store distribution ([AWAI-3138](https://linear.app/kotobalabs/issue/AWAI-3138)), physical devices, Figma design review and TalkBack testing remain open.
