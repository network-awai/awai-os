# Soudan / Bengoshi Distribution & Onboarding Pipeline (2026-11-27, Kanji #218)

Pre-GO preparation runbook for two completely-free Itonami apps:

| App | Package ID | Static Host | Bundled Asset | Staged Online File | APK Budget |
| --- | --- | --- | --- | --- | --- |
| Soudan | `network.itonami.soudan` | `https://soudan.itonami.app` | `packages/soudan.apk` | `online-soudan.apk` | 64 MiB |
| Bengoshi | `network.itonami.bengoshi` | `https://bengoshi.itonami.app` | `packages/bengoshi.apk` | `online-bengoshi.apk` | 64 MiB |

References:
- [store/README.md](../../store/README.md) — publisher single-source rule (AWAI-3882), signing key custody, Store-then-Play order, `rel-YYYYMMDD-rNNN/release.json` record
- [store/site/README.md](../../store/site/README.md) — `store.itonami.app` build, verification rules, and publishing flow
- [store/latest/README.md](../../store/latest/README.md) — signed latest pointer and key list (`store/latest/pointer-envelope.json`, `store/latest/keys-envelope.json`)
- [docs/otehon/itonami-store-web-entry-publication-20261121.md](itonami-store-web-entry-publication-20261121.md) — first `*.itonami.app` Cloudflare name-plane publication record
- `network-awai/app-itonami-yataverse` `docs/name-plane-deploy-runbook.md` — `yataverse-bytes` name-plane deployment steps and limits
- `network-awai/network-awai-apex` `docs/itonami-domain-unification-design.md` §8 (§8.7) — primary-node vs Cloudflare fallback rule

---

## 1. Static Publication (`soudan.itonami.app`, `bengoshi.itonami.app`)

Both hosts use the existing `yataverse-bytes` Worker name plane on Cloudflare account `cloud-kotoba` (route `*.itonami.app/*`). No new Worker, route, or request-time handler is added.

### Static-site constraints
- **Mandatory HTML `<meta>` headers**: `names.mjs` sets no `Content-Security-Policy` HTTP response header. Every HTML document must embed `<meta http-equiv="Content-Security-Policy" ...>` and `<meta name="referrer" content="no-referrer">`.
- **Size ceiling**: 40-block / ~10 MiB per-file cap enforced by the name plane.
- **No SPA fallback**: every route must resolve to a real static file in the packed UnixFS directory (unknown paths return `404`).
- **No app-origin processing**: static content only — no request-time server processing, proxy, or server-held business state on `*.itonami.app`.

### Publication steps (per host, after Legal GO + owner DNS approval)
1. Pack the built static directory locally and record the printed UnixFS root CID:
   ```sh
   yataverse site-pack <site-dir> -o <car-dir>
   ```
2. Upload the CAR blocks and confirm `verified: true` and `receiptVerified: true`:
   ```sh
   yataverse car-put <car-dir>/site-001.car
   ```
3. In the Cloudflare dashboard (`cloud-kotoba`), create/update **exactly one** DNS-only TXT record (TTL Auto):
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

## 2. Android Itonami Store & Awai OS Onboarding

Awai OS distributes apps through the Itonami Store catalog (AWAI-4094), so Android Itonami Store onboarding covers both Android devices and Awai OS.

- **Catalog registration**:
  - `network.itonami.soudan` and `network.itonami.bengoshi` are explicitly registered in [Catalog.java](../../android/shared/src/network/awai/platform/Catalog.java) (`assetFor`, `onlineFileFor`, `maxApkBytes = 64 * 1024 * 1024`) and checked by [SoudanBengoshiCatalogCheck.java](../../android/test/SoudanBengoshiCatalogCheck.java).
  - `android/build.py:store_query_packages()` automatically includes both package IDs in the Store `<queries>` manifest (verified by [store-queries.py](../../android/tests/store-queries.py)) without `QUERY_ALL_PACKAGES`.
- **APK & runtime profile**:
  - **Dual-ABI Tauri v3 APK**: `arm64-v8a` + `x86_64` (AWAI-4094), fitting the 64 MiB Store budget.
  - **External inference boundary**: both apps call external inference endpoints, so they use `restricted-wasm-v1` + a signed `descriptor.json` with fresh per-operation consent. They are **not** offline-only local apps and must **not** be added to `android/local-apps.json` (`Catalog.LOCAL_APPS`).
  - **Android hardening**: 16 KB page-size ELF alignment, system-bar insets (`packages/awai-system-bars`), `android:allowBackup="false"`, and `android:usesCleartextTraffic="false"`.
- **Publisher metadata**:
  - `Awai Network LLC` is defined once in [series-apps.json](../../store/catalog-source/series-apps.json) (`publisher` field, AWAI-3882) and referenced by the catalog builder and release record; never duplicate the literal per app entry.
- **Release record (`store/distribution/rel-YYYYMMDD-rNNN/release.json`)**:
  - Every production release adds a monotonic `store/distribution/rel-YYYYMMDD-rNNN/` directory (existing `dev-*` directories are immutable history) containing the signed catalog envelope, APK bytes, and one `release.json` recording `publisher`, `app.{name, versionName, versionCode}`, `apkSha256`, `signerPublicKeySha256` (public fingerprint only), and `commitSha`. See [store/README.md](../../store/README.md).
- **Distribution order**:
  - **Store first, then Play**: publish and verify on the Itonami Store catalog and `store.itonami.app` before submitting to Google Play.
- **Signing key custody & rotation**:
  - Production signing keys (root, catalog, pointer, APK, and Play) stay exclusively with the owner — never committed to git, passed to CI, or logged.
  - Production cutover follows the **2026-11-29 production signing key rotation** (replacing the development Android debug APK key and dev key-list root/role keys).

---

## 3. `store.itonami.app` Rebuild & Republish Procedure

After a new signed catalog and `store/latest/pointer-envelope.json` land on `main`:

```sh
# 1. Verify site builder tests from a clean checkout of main
node --test store/site/build.test.mjs

# 2. Build static entry page (verifies key list, pointer/catalog signatures & expiry,
#    commit-pinned raw.githubusercontent.com URLs, APK SHA-256/sizes, and non-blank publisher)
node store/site/build.mjs --out <new-dir>

# 3. Pack UnixFS directory and upload CAR to yataverse-bytes
yataverse site-pack <new-dir> -o <car-dir>
yataverse car-put <car-dir>/site-001.car
```

4. Update `_dnslink.store.itonami.app` TXT to `dnslink=/ipfs/<root>` in the Cloudflare dashboard (`cloud-kotoba`).
5. Fetch `index.html`, `style.css`, `logo.png`, and `site-manifest.json` from `https://store.itonami.app/` and confirm every SHA-256 matches `<new-dir>/site-manifest.json`.
6. Remember the 30-day pointer expiry (`store/site/README.md`): rebuild and republish whenever a new pointer is signed.

---

## 4. Explicit Pre-GO Gates

Public launch and production merge remain **blocked** until all four gates are satisfied:

1. **Legal GO**: mandatory legal disclosures, disclaimers, and finding-9 external-operation consent disclosures reviewed and approved by Legal for both `Soudan` and `Bengoshi`.
2. **Owner DNS approval**: explicit owner approval before creating or editing `_dnslink.soudan.itonami.app`, `_dnslink.bengoshi.itonami.app`, or `_dnslink.store.itonami.app` in Cloudflare (`cloud-kotoba`).
3. **Owner signing-key approval**: owner-controlled production signing keys and the 2026-11-29 production key rotation (no keys are generated, rotated, or stored by this prep change).
4. **Release artifacts**: signed dual-ABI (`arm64-v8a` + `x86_64`) APKs and signed `descriptor.json` artifacts produced from the owning app repositories and recorded under `store/distribution/rel-YYYYMMDD-rNNN/`.
