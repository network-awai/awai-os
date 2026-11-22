# Murakumo Net (`network.awai.murakumo.net`)

Murakumo Net holds the network half of Murakumo, so that the inference app `network.awai.murakumo`
has no INTERNET permission (PHI rule; karute passes medical text to it).

- **What it does:** model downloads from Hugging Face (canonical client-runtime broker, consent per download,
  host-stream sink, SHA-256 and byte budget), and the owner-pinned devices' usage reads (All devices).
- **What it never does:** inference, prompts or outputs. It has no `InferenceRequestActivity` and no engine.
- **Hand-off:** a finished download must match the pinned catalog's size and SHA-256 here. Murakumo then gets a
  one-file read grant on this app's FileProvider (`files/downloads/`) and admits the file again itself
  (`InferenceStatusProvider` "admit", allowed only for this package with the same signature). The local copy
  is deleted whether or not Murakumo accepts it.
- **Status and this device's usage** are read from Murakumo's provider ("status", "usage"); nothing else.

The page is Murakumo's (`apps/murakumo/client`, role `net`):

```sh
npm ci --prefix apps/murakumo-net
npm run build --prefix apps/murakumo-net     # node apps/murakumo/scripts/build.mjs --net
npm run tauri --prefix apps/murakumo-net -- android build --apk --target aarch64
```

**Disclosures (blocker).** The canonical runtime requires a `disclosure` for every operation (KOTOBA-159 finding 9):
recipient, country, data, purpose, frequency, withdrawal and, outside Japan, `country-name` and `foreign-info-url`
(a page with the 施行規則 17 条 2 項 information). Legal writes them in `disclosures.json`, keyed by capability
(`awai.murakumo.model-download`, `awai.murakumo.device-usage`). Until that file exists the build stops with
`disclosure-pending`; no value is invented in code.

**Signing.** Murakumo admits this app by package name **and** a matching signature, and this app uses
Murakumo's `signature` permission. Both must therefore be signed with the same key (in development, the
Android debug identity). See the PR for the catalog and key-group consequences.
