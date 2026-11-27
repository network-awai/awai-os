# Soudan / Bengoshi Distribution & Onboarding Pipeline (2026-11-27, Kanji #218)

Pre-GO preparation runbook for two completely-free Itonami apps (synced with AwaiSpec `msg_5a9758515318`, Dev #220 `msg_545421bb0e46` / `e2754`, and Legal #224 `msg_5e494628b474`):

| App | Package ID | Static Host | Bundled Asset | Staged Online File | APK Budget | Current Static Baseline |
| --- | --- | --- | --- | --- | --- | --- |
| Soudan (自己整理メモツール) | `network.itonami.soudan` | `https://soudan.itonami.app` | `packages/soudan.apk` | `online-soudan.apk` | 64 MiB | [apps/soudan](../../apps/soudan) (`trusted-page-v1`, `kotoba` `889239dc`) |
| Bengoshi (公開弁護士検索ガイド・中立プレビュー) | `network.itonami.bengoshi` | `https://bengoshi.itonami.app` | `packages/bengoshi.apk` | `online-bengoshi.apk` | 64 MiB | No static Web artifact yet |

References:
- [store/README.md](../../store/README.md) — publisher single-source rule (AWAI-3882), signing key custody, Store-then-Play order, `rel-YYYYMMDD-rNNN/release.json` record
- [store/site/README.md](../../store/site/README.md) — `store.itonami.app` build, verification rules, and publishing flow
- [store/latest/README.md](../../store/latest/README.md) — signed latest pointer and key list (`store/latest/pointer-envelope.json`, `store/latest/keys-envelope.json`)
- [docs/otehon/itonami-store-web-entry-publication-20261121.md](itonami-store-web-entry-publication-20261121.md) — first `*.itonami.app` Cloudflare name-plane publication record
- `network-awai/app-itonami-yataverse` `docs/name-plane-deploy-runbook.md` — `yataverse-bytes` name-plane deployment steps and limits
- `network-awai/network-awai-apex` `docs/itonami-domain-unification-design.md` §8 (§8.7) — primary-node vs Cloudflare fallback rule

---

## 1. Static Publication (`soudan.itonami.app`, `bengoshi.itonami.app`)

Both hosts use the existing `yataverse-bytes` Worker name plane on Cloudflare account `cloud-kotoba` (route `*.itonami.app/*`, B2 bucket prefix `yataverse-blocks/ipld/`, single CIDv1 per `_dnslink` TXT record). No new Worker, route, or request-time handler is added.

### Static HTTP headers, CSP & inference posture
- **Current `yataverse-bytes` (`worker/src/names.mjs`) gap**: `names.mjs` emits **none** of HTTP `Content-Security-Policy`, `Referrer-Policy`, `Strict-Transport-Security`, or `Permissions-Policy`.
- **Two-layer header requirement before public GO**:
  1. **HTML `<meta>` (mandatory in every static HTML file)**: embed `<meta http-equiv="Content-Security-Policy" ...>` and `<meta name="referrer" content="no-referrer">`.
  2. **Dev-side edge response headers (mandatory before public GO)**: add HTTP `Content-Security-Policy`, `Referrer-Policy`, `Strict-Transport-Security`, and `Permissions-Policy` at the edge before general public release.
- **Per-app inference posture**:
  - **`Soudan`**: inference is **default OFF (on-device complete)** (`connect-src 'none'` by default / until Legal & Dev gates are satisfied) with optional opt-in to synchronous `api.murakumo.cloud` `/v1/chat/completions` only, subject to per-operation consent, anonymization warning, Route B honest disclosure (or post-Route A completion), and blocked billing/ad links.
  - **`Bengoshi`**: `murakumo.cloud` inference is **prohibited (`operations: []`, deleted/disabled)**.
- **Static artifact baseline**: `awai-os/apps/soudan` currently exists as static-buildable `trusted-page-v1` (`kotoba` `889239dc`); `bengoshi` has no static Web artifact yet.
- **Name-plane limits**:
  - 40-block / ~10 MiB per-file cap.
  - No SPA fallback (every route must map to an actual file in the packed UnixFS directory; unknown paths return `404`).
  - No app-origin processing (static files only; no server-side request processing, proxy, or server-held business state).

### Pre-approval `yataverse car-put` prohibition (Dev #220 `e2754` + Legal #224)
- **Local-only verification before approval**: `yataverse car-put` immediately makes uploaded blocks publicly retrievable by CID (`https://yataverse.com/ipfs/<cid>`) even without a `_dnslink` TXT record.
- Therefore, pre-approval verification MUST stop at local `yataverse site-pack`: **do NOT run `yataverse car-put` and do NOT create/edit `_dnslink` TXT** until all 3 Legal #224 pre-launch owner blockers in §6 are resolved.

### Publication steps (per host, ONLY after Legal #224 blockers + owner DNS approval)
1. Pack the built static directory locally and record the printed UnixFS CIDv1 root (safe for local pre-approval verification):
   ```sh
   yataverse site-pack <site-dir> -o <car-dir>
   ```
2. **Post-approval only** — upload the CAR blocks (stored under B2 `yataverse-blocks/ipld/`) and confirm `verified: true` and `receiptVerified: true`:
   ```sh
   yataverse car-put <car-dir>/site-001.car
   ```
3. **Post-approval only** — in the Cloudflare dashboard (`cloud-kotoba`), create/update **exactly one** DNS-only TXT record (TTL Auto, single CIDv1):
   - `_dnslink.soudan.itonami.app` = `dnslink=/ipfs/<root>`
   - `_dnslink.bengoshi.itonami.app` = `dnslink=/ipfs/<root>`
   (Local `wrangler` login cannot edit DNS.)
4. **Verify**:
   - Confirm `GET https://<host>/` returns `200`, `x-ipfs-roots` equals `<root>`, and the SHA-256 of every served file matches the local build manifest.
   - Note cache TTLs: DNSLink is cached ~60 s and responses ~300 s.
5. **Rollback**:
   - Delete the `_dnslink.<host>` TXT record in Cloudflare. The host returns `404 name-not-published` (uploaded blocks stay unreferenced).
6. **§8 primary-node fallback**:
   - Per `network-awai-apex` `docs/itonami-domain-unification-design.md` §8 (§8.7), the Awai node remains primary and Cloudflare is fallback. Once the node entrance is restored, pin the same UnixFS root on the node and add a DNS-only `A` record for the host pointing to the node.

---

## 2. Legal #224 Hard Stops, Scope & Prohibited Wording (`msg_5e494628b474`)

### 2.1 Prohibition of false `murakumo.cloud` claims
- While `https://murakumo.cloud/legal-privacy` does not guarantee processing-country pinning or service-wide zero retention (and `https://murakumo.cloud/legal-terms` remains `DRAFT`), writing **「ログ不保存」「完全非保持」「日本国内限定」** is **strictly prohibited** in UI, distribution docs, and Store descriptions.
- **Route A vs Route B**:
  - **Route A**: dedicated Japan node pinning + external fallback disabled + physical non-retention + privacy/terms policy revision (including resolving `/legal-terms` `DRAFT`).
  - **Route B** (required until Route A completes): honest disclosure reflecting actual retention/processing posture, explicitly naming the formal operator **`Awai Network LLC`**.

### 2.2 `Soudan` (`network.itonami.soudan` / `soudan.itonami.app`) scope & hard stops
- **Allowed scope**: self-organization memo tool (**自己整理メモツール**). Inference is **default OFF (on-device complete)**; optional opt-in uses synchronous `/v1/chat/completions` only, with fresh per-operation consent, anonymization warning, Route B honest disclosure (or post-Route A), and billing/ad links blocked.
- **Hard Stops (prohibited)**:
  - Individual legal judgment.
  - Infringement determination.
  - Automatic generation of filing/submission documents.
  - Operator-named **「法律相談」** branding or labels anywhere in UI, docs, or Store descriptions.

### 2.3 `Bengoshi` (`network.itonami.bengoshi` / `bengoshi.itonami.app`) scope & hard stops
- **Allowed pre-O10 minimum safe scope**:
  - Public lawyer search guide + neutral search preview UI using **synthetic sample data (fictitious persons) only**, explicitly displaying:
    `プレビュー版：実在弁護士の掲載・連絡取次は外部弁護士確認後に開始`
  - Participation-terms policy preview.
  - `murakumo.cloud` inference **prohibited (`operations: []`, deleted/disabled)**.
- **Hard Stops (prohibited)**:
  - 0 real lawyers listed (no real lawyer directory entries before O10 sign-off).
  - No registration intake.
  - No in-app contact relay.
  - No inference use.
  - Prohibited wording: **「マッチング」** and **「紹介」** must never appear as descriptions or labels anywhere in UI, docs, or Store listings.

---

## 3. AwaiSpec `restricted-wasm-v1` & MCP/ACP Boundary Requirements

All new/public builds of `Soudan` and `Bengoshi` in their owning app repositories must satisfy:

- **Runtime & consent pin**: `restricted-wasm-v1` pinning `kotoba-lang/kotoba` `main` (`d6ff50e6`+) `kotoba-client-runtime.js` and `kotoba-client-consent.css` via `vendor/PINS.json` — no custom validator or custom consent modal.
- **Canonical descriptor & consent**: `app-descriptor.json` in canonical `{origin, routes: [...]}` form with `consent: "each-operation"` and `special-care` disclosure confirmed with `Legal` (`Soudan` opt-in `api.murakumo.cloud` synchronous `/v1/chat/completions` gated on Route B/A & Legal GO; `Bengoshi` declares `operations: []` with inference prohibited).
- **Form submission discipline**: use `bindForm` (`type="button" data-submit`); never use native `submit` or `requestSubmit()`.
- **Repository & release hygiene**:
  - `blueprint.edn` (single classification key, SPDX license identifier)
  - `NOTICE`
  - `dist/release.json` (`awai.app.artifact.v1`)
  - `check-public.mjs`-equivalent public-hygiene check passing cleanly
- **Web parity table**: explicitly document Web fallbacks wherever Android platform features such as the Android share sheet are unavailable (e.g. `device.save`).
- **Protocol boundary**:
  - Product UI uses **MCP + MCP Apps (SEP-1865) + Agent Plugins v1.0.0 + Agent Skills** (`AWAI-4143` formal conformance is gated on the spec PR + `catalog.list` POC).
  - **IDE ACP (`AWAI-4003` #07)** is restricted strictly to IDE <-> coding agent interactions and is **never** used in product UI.

---

## 4. Android Itonami Store & Awai OS Onboarding

Awai OS distributes apps through the Itonami Store catalog (`AWAI-4094` / `awai-os#523`), so Android Itonami Store onboarding covers both Android devices and Awai OS.

- **Catalog registration**:
  - `network.itonami.soudan` and `network.itonami.bengoshi` are explicitly registered in [Catalog.java](../../android/shared/src/network/awai/platform/Catalog.java) (`assetFor`, `onlineFileFor`, `maxApkBytes = 64 * 1024 * 1024`) and verified by [SoudanBengoshiCatalogCheck.java](../../android/test/SoudanBengoshiCatalogCheck.java).
  - `android/build.py:store_query_packages()` automatically includes both package IDs in the Store `<queries>` manifest (verified by [store-queries.py](../../android/tests/store-queries.py)) without `QUERY_ALL_PACKAGES`.
  - Both apps are dual-ABI (`arm64-v8a` + `x86_64`) `restricted-wasm-v1` apps kept outside `android/local-apps.json` (`Catalog.LOCAL_APPS`, 40 MiB) with a 64 MiB budget: `Soudan` keeps `api.murakumo.cloud` inference default OFF (opt-in gated on Route B honest disclosure or Route A & Legal GO), while `Bengoshi` prohibits inference (`operations: []`).
- **Exact Android / Awai OS build requirements**:
  - **Tauri pin**: Tauri `3.0.0-alpha.6` + pinned `tauri-runtime-wry`.
  - **SDK & ABI**: `minSdkVersion` API 33, dual-ABI (`arm64-v8a` + `x86_64`), fitting the 64 MiB Store budget.
  - **16 KB page-size alignment**: ELF `Align 0x4000` + `zipalign -P 16`.
  - **UI & manifest hardening**: system-bar insets (`packages/awai-system-bars`), `android:allowBackup="false"`, and `android:usesCleartextTraffic="false"`.
- **Publisher metadata**:
  - `Awai Network LLC` is defined once in [series-apps.json](../../store/catalog-source/series-apps.json) (`publisher` field, AWAI-3882) and referenced by the catalog builder and release record; never duplicate the literal per app entry.
- **Debug vs production separation & release record**:
  - Maintain strict separation between debug-signed development builds (`store/distribution/dev-*`, immutable history) and production releases (`store/distribution/rel-YYYYMMDD-rNNN/`).
  - Each production release directory holds the signed catalog envelope, APK bytes, and one `release.json` recording `publisher`, `app.{name, versionName, versionCode}`, `apkSha256`, `signerPublicKeySha256` (public fingerprint only), and `commitSha`. See [store/README.md](../../store/README.md).
- **Distribution order**:
  - **Store first, then Play**: publish and verify on the Itonami Store catalog and `store.itonami.app` before submitting to Google Play.
- **Signing key custody & rotation**:
  - Production signing keys (root, catalog, pointer, APK, and Play) stay exclusively with the owner — never committed to git, passed to CI, or logged.
  - Production cutover follows the **2026-11-29 production signing key rotation** (replacing the development Android debug APK key and dev key-list root/role keys).

---

## 5. `store.itonami.app` Rebuild & Republish Procedure

After a new signed catalog and `store/latest/pointer-envelope.json` land on `main` (post-approval only — do not run `car-put` for pre-approval artifacts):

```sh
# 1. Verify site builder tests from a clean checkout of main
node --test store/site/build.test.mjs

# 2. Build static entry page (verifies key list, pointer/catalog signatures & expiry,
#    commit-pinned raw.githubusercontent.com URLs, APK SHA-256/sizes, and non-blank publisher)
node store/site/build.mjs --out <new-dir>

# 3. Pack UnixFS directory locally (safe pre-approval)
yataverse site-pack <new-dir> -o <car-dir>

# 4. Upload CAR to yataverse-bytes (POST-APPROVAL ONLY — publishes blocks at /ipfs/<cid>)
yataverse car-put <car-dir>/site-001.car
```

5. Update `_dnslink.store.itonami.app` TXT to `dnslink=/ipfs/<root>` in the Cloudflare dashboard (`cloud-kotoba`).
6. Fetch `index.html`, `style.css`, `logo.png`, and `site-manifest.json` from `https://store.itonami.app/` and confirm every SHA-256 matches `<new-dir>/site-manifest.json`.
7. Remember the 30-day pointer expiry (`store/site/README.md`): rebuild and republish whenever a new pointer is signed.

---

## 6. Explicit Pre-GO Gates

Public launch, `yataverse car-put` upload, DNS updates, and production merge remain **blocked** until all gates below are satisfied:

1. **Legal #224 pre-launch owner blockers (required before any `yataverse car-put` or `_dnslink` TXT edit)**:
   1. Confirm public operator entity name, address, representative, and contact desk for `*.itonami.app` (footer/policy).
   2. Complete `murakumo.cloud` **Route B** honest disclosure (explicitly naming `Awai Network LLC`) or **Route A** (Japan-dedicated node pinning + external fallback disabled + physical non-retention + privacy/terms policy revision resolving `/legal-terms` `DRAFT`).
   3. Obtain explicit owner acceptance of pre-O10 residual risk.
2. **Legal GO gates (general public release)**:
   - `kotoba-client-runtime.js` consent wording replacement completed.
   - ADR 0001 (`AWAI-3232`) revised to the completely-free premise.
   - Mandatory conditions from `Legal` responses (`msg_ce3b129002e9`, `msg_5e494628b474`) — including §2 wording/scope Hard Stops, `special-care`, and finding-9 external-operation consent disclosures — reflected in both apps.
   - O10 external lawyer review gate passed.
3. **Edge security & inference gates (Dev)**:
   - Dev-side HTTP edge security headers (`Content-Security-Policy`, `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy`) deployed on `*.itonami.app`.
   - `Soudan` keeps `connect-src 'none'` / inference OFF by default until Route B/A and Legal GO are satisfied (`Bengoshi` keeps `operations: []` with inference prohibited).
4. **Owner DNS approval**:
   - Explicit owner approval before creating or editing `_dnslink.soudan.itonami.app`, `_dnslink.bengoshi.itonami.app`, or `_dnslink.store.itonami.app` in Cloudflare (`cloud-kotoba`).
5. **Owner signing-key approval**:
   - Owner-controlled production signing keys and the 2026-11-29 production key rotation (no keys are generated, rotated, or stored by this prep change).
6. **Release artifacts**:
   - Static Web artifacts built for both apps (including new `bengoshi` static build within §2.3 pre-O10 safe scope) plus signed dual-ABI (`arm64-v8a` + `x86_64`) Tauri `3.0.0-alpha.6` APKs, signed `app-descriptor.json`, `dist/release.json` (`awai.app.artifact.v1`), and `store/distribution/rel-YYYYMMDD-rNNN/release.json` records.
