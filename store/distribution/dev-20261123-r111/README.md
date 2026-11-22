# Itonami Store development catalog r111 (AWAI-3159)

r111 carries forward the eight entries of r110 unchanged (same ids, versions, operations and exact APK
digests; the APKs stay in their earlier directories) with revision 111, and adds:

- `network.itonami.paymentdrafts` (Payment Drafts, AWAI-3157/3159) — `paymentdrafts.apk`
- `network.itonami.securitiesdrafts` (Securities Drafts, AWAI-3158/3159) — `securitiesdrafts.apk`

Both are Tauri v3 debug APKs built from `apps/payment-drafts` and `apps/securities-drafts` in this
repository with `CARGO_BUILD_JOBS=4 nice -n 10 npx tauri android build --debug --apk --target aarch64`
(JDK 21, NDK 27.0.12077973, aarch64):

| app | versionCode | bytes | sha256 |
|---|---|---|---|
| paymentdrafts | 1000 (0.1.0) | 21,801,241 | `2637069876b59e9ac8e6cfc7138e3a6a7885d3b26e3727e007e697bf9acaaa28` |
| securitiesdrafts | 1000 (0.1.0) | 21,798,452 | `b246bf08434302c8f8a6f793d8bb97f63cea35dbd19a1fd46f829e4929446062` |

Both declare no external operation and request no `INTERNET` permission. `aapt2 dump permissions` shows
only AndroidX's `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` for each. Their catalog assets are
`packages/paymentdrafts.apk` and `packages/securitiesdrafts.apk` (40 MiB budget, enforced by
`Catalog.java` local-app path and `android/build.py --payment-drafts-apk` / `--securities-drafts-apk`).

Signing: **Android development debug only** (signer SHA-256
`1c73b625bebc3e897b27d74e32813c12c34628288f037eed59ec6120d6f65061`, the debug identity on the
build host). **No release signing** — the signing key is owner-held and release signing is a separate
decision. This catalog raw is **not yet signed**: the development catalog key lives in
`~/.android/awai-store-dev/` on the development Mac (see `store/keys/README.md`) and is absent on this
host, so the envelope must be signed there before this catalog can be trusted by a Store built from this
repository (AWAI-3775). The `expiresAt` above is a placeholder (build time + 30 days); refresh it at
signing time if it is close to expiry.

## Signing and publishing (follow-up, on the development Mac)

```sh
# 1. Sign the r111 catalog envelope with the development catalog key (must be listed in the key list).
#    Build the key-list directory exactly as in store/keys/README.md, then:
python3 android/sign-catalog-envelope.py \
  --raw store/distribution/dev-20261123-r111/catalog-rev111-raw.json \
  --key-list <key-list-dir> \
  --keystore ~/.android/awai-store-dev/catalog.p12 --alias catalog --pass-env <ENV-NAME> \
  --out store/distribution/dev-20261123-r111/catalog-envelope.json

# 2. Update android/online-pins.dev.json to the new catalog envelope (revision = the commit that
#    contains this directory) and the two APK pins (already staged in this change for the APKs, but the
#    catalog pin above stays on r110 until the envelope exists), or pass --pins FILE.

# 3. Publish the latest pointer (sequence above the published 4):
python3 android/publish-latest-pointer.py --sequence 5
# 4. Commit store/latest/pointer-envelope.json to main. A pointer lasts 30 days; re-sign before expiry.

# The pins in android/online-pins.dev.json must name a commit that already contains the files
# (artifacts land first, pins follow), per store/latest/README.md.
```

The APKs themselves are stored in this directory alongside the raw catalog; the signed catalog is
`itonami.store.bundled.v1` and the Store validates each APK's digest, signer, package and versionCode
independently. Nothing here is published or installed by this change.
