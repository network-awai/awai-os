# Itonami Store development catalog r112 (AWAI-3115, item 134)

r112 carries forward the ten entries of r111 unchanged (same ids, versions, operations and exact APK
digests; the APKs stay in their earlier directories) with revision 112, and adds the seven release-signed
creator dapps of Store item 134:

- `network.itonami.animeka` (Animeka) — `animeka.apk`
- `network.itonami.dougaka` (dougaka Studio — Itonami メディア制作) — `dougaka.apk`
- `network.awai.gaka` (画家) — `gaka.apk`
- `network.itonami.gameka` (Gameka Studio) — `gameka.apk`
- `network.itonami.isco2641` (Independent Writing Practice) — `isco2641.apk`
- `network.itonami.mangaka` (mangaka (漫画家) — AI manga publishing and reworking) — `mangaka.apk`
- `network.itonami.ongakuka` (Ongakuka — AI Music Generator) — `ongakuka.apk`

Each is a Tauri v3 release-signed APK (arm64-v8a only, versionCode 1000 / versionName 0.1.0, not
debuggable) supplied pre-built and signed; they were not rebuilt in this change. App names above are the
APK application labels read from the APKs. The bytes and SHA-256 below were re-measured after copying
into this directory and match the accepting side exactly:

| app | package id | versionCode | bytes | sha256 |
|---|---|---|---|---|
| animeka | network.itonami.animeka | 1000 (0.1.0) | 12,552,458 | `ab1398625a682e256cbcf4c129cc3d0624eb3cea50b7df6be410c7f3280899ef` |
| dougaka | network.itonami.dougaka | 1000 (0.1.0) | 12,802,310 | `88c1673360208bec2ce9295ebc641af8c0b8eb19c24338829c7df05b06827479` |
| gaka | network.awai.gaka | 1000 (0.1.0) | 4,788,881 | `29df849813a9acdc60b96e03872c01474be5f9d87e592dc9868964ab00d51421` |
| gameka | network.itonami.gameka | 1000 (0.1.0) | 12,519,692 | `98cc34e8e4bdee8861319e2dac34dccd6f89da2ed5c8b68fabaa2ae2272837b9` |
| isco2641 | network.itonami.isco2641 | 1000 (0.1.0) | 12,544,269 | `e50b41fe057f5067b276c529fc752939a8ed1c7a8f68baddfd5fb8114c179675` |
| mangaka | network.itonami.mangaka | 1000 (0.1.0) | 12,495,110 | `25ed2f70c38ed5c51335f92d028b187b521ef3493191c79e7bf5016b1eafbbcf` |
| ongakuka | network.itonami.ongakuka | 1000 (0.1.0) | 12,564,751 | `4fb20e8c4d9493d03f8fe507d8f733198fcd09b117144883b44cfb021b2fadfb` |

Their catalog assets are `packages/animeka.apk`, `packages/dougaka.apk`, `packages/gaka.apk`,
`packages/gameka.apk`, `packages/isco2641.apk`, `packages/mangaka.apk` and `packages/ongakuka.apk`
(40 MiB budget, enforced by `Catalog.java` `assetFor` / `onlineFileFor` / `maxApkBytes` for these seven
ids, admitted in #471/#472). Each asset name is 1:1 with its package id; no two entries share a file.

Signing: **release-signed** (single signer, `CN=AWAI Release, O=AWAI, C=JP`, certificate SHA-256
`a90ff0c5b71570eb239356bc8bf2d97005f63c6b92924e001e065b5063a2f049`, verified with `apksigner
verify --print-certs` on each APK). This is the owner-approved placement condition: only signed APKs,
matching the accepted sha256/bytes. The catalog raw (`catalog-rev112-raw.json`) records that signer per
artifact. The two new-entry publishers use the single publisher definition (`Awai Network LLC`,
`store/catalog-source/series-apps.json` via `PUBLISHER` in `android/build.py`); the ten r111 entries
keep their published publisher unchanged.

This catalog raw is **not yet signed**: the development catalog key lives in `~/.android/awai-store-dev/`
on the development Mac (see `store/keys/README.md`) and is absent on this host, so the envelope must be
signed there before this catalog can be trusted by a Store built from this repository (AWAI-3775). The
`expiresAt` above is a placeholder (build time + 30 days); refresh it at signing time if it is close to
expiry.

The CDN pins in `android/online-pins.dev.json` point at the artifacts commit of this change (the commit
that first contains this directory), following the rule in `store/latest/README.md` that a pin must name
a commit that already contains the files. After this change is squash-merged, the pins revision must be
re-pointed at the merge head (which will contain this directory) in a follow-up, as was done for r111;
until then the pins must not be used to build a signed Store. The signed Store build
(`android/build.py` with a catalog key) was not run for this change and the catalog signature is out of
scope here. The `store/latest` pointer stays unissued (`catalog envelope 未署名 / store/latest pointer
未発行（follow-up: 鍵保持者）`).

## Signing and publishing (follow-up, on the development Mac)

```sh
# 1. Sign the r112 catalog envelope with the development catalog key (must be listed in the key list).
#    Build the key-list directory exactly as in store/keys/README.md, then:
python3 android/sign-catalog-envelope.py \
  --raw store/distribution/dev-20261123-r112/catalog-rev112-raw.json \
  --key-list <key-list-dir> \
  --keystore ~/.android/awai-store-dev/catalog.p12 --alias catalog --pass-env <ENV-NAME> \
  --out store/distribution/dev-20261123-r112/catalog-envelope.json

# 2. Update android/online-pins.dev.json to the new catalog envelope (revision = the commit that
#    contains this directory) and the seven APK pins (already staged in this change for the APKs, but the
#    catalog pin above stays on r110 until the envelope exists), or pass --pins FILE.
#    Re-point the revision at the squash-merge head first (see note above).

# 3. Publish the latest pointer (sequence above the published 4):
python3 android/publish-latest-pointer.py --sequence 5
# 4. Commit store/latest/pointer-envelope.json to main. A pointer lasts 30 days; re-sign before expiry.

# The pins in android/online-pins.dev.json must name a commit that already contains the files
# (artifacts land first, pins follow), per store/latest/README.md.
```

The APKs themselves are stored in this directory alongside the raw catalog; the signed catalog is
`itonami.store.bundled.v1` and the Store validates each APK's digest, signer, package and versionCode
independently. Nothing here is published or installed by this change.
