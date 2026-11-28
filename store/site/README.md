# Itonami Store entry page (AWAI-3730)

`build.mjs` generates the static entry page for the Itonami Store from the signed latest pointer
(`store/latest/pointer-envelope.json`). The host is `store.itonami.app` (owner decision
2026-11-21, AWAI-3731). The page is live there since 2026-11-21; see "Publishing" below. The build
itself sends nothing.

```sh
node --test store/site/build.test.mjs
node store/site/build.mjs --out <new directory>
```

Output: `index.html`, `style.css`, `logo.png` and `site-manifest.json` (`awai.store-site.v1`, with the SHA-256
of each file, the pointer sequence, the catalog revision and each listed APK).

The screen composition is designed in Figma, and the HTML and CSS follow it (AWAI-3735, AWAI-3736):
[docs/otehon/itonami-store-web-entry-figma-20261121.md](../../docs/otehon/itonami-store-web-entry-figma-20261121.md).
Change the Figma proposal first, then this directory. The colors, type ramp, spacing and radius in
`style.css` are copies of the Figma variables and text styles; they are not read from Figma at build time.

## What the build checks

An app is listed with a download link only when all of these hold. Any failure stops the build.

- Who may sign (AWAI-3775): when `store/keys/store-root.der` and `store/latest/keys-envelope.json` are both in
  the repository, the key list must verify against that root with the Store's rules
  (`android/client/key-list.js`); the pointer must then be signed by a listed pointer key and the catalog by a
  listed catalog key. Otherwise, as before, the signer certificate (`store/keys/dev-catalog-signer.pem`) has the
  pinned SHA-256 fingerprint and signs both.
- The pointer envelope is signed by that key (SHA256withRSA), has the `itonami.store.latest.v1`
  schema, a lifetime of at most 31 days, and has not expired.
- Every pinned URL is a commit-pinned `raw.githubusercontent.com/network-awai/awai-os/<commit>/store/distribution/…` URL.
- The catalog envelope in this repository has the pinned SHA-256 and size, is signed by the same key,
  has the `itonami.store.bundled.v1` schema, and has not expired.
- Each APK pin equals the catalog's SHA-256 for that app, and no pin names an unlisted app.
- Each APK present in this repository has the catalog's size and SHA-256.
- Every listed app carries a non-blank publisher from the signed catalog (AWAI-3882). A
  missing or blank publisher aborts the build (`publisher`) instead of rendering a blank
  配布元; the detail view shows each app's publisher as 配布元 and `site-manifest.json`
  carries the same value per app.

## What the page is

- A document: HTML, CSS and one same-origin logo image. No script, no form, no remote subresource,
  no web font. The `Content-Security-Policy` meta is
  `default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'`.
- `logo.png` is the Figma component `Awai / Site logo 02 master` exported at 128 px.
- The page sends nothing until the person follows a link. Each download link names its host and
  shows the SHA-256 and signer next to it. There is no request-time handler, per-user state or proxy.
- The default build displays the development channel. The production build uses separate signed inputs
  and checks the APKs against their approved signers before showing a release download.
- It does not offer the Store APK itself, an iOS build or a desktop build. None is published.
- It shows each app's publisher from the signed catalog as 配布元 and writes the same value
  into `site-manifest.json`. Production catalogs carry `Awai Network LLC`, defined once in
  `store/catalog-source/series-apps.json` (see `store/README.md`); signed development catalogs
  keep the publisher they were signed with. The page never invents a publisher string.

## Build a production candidate

Use a clean checkout containing the release catalog and APKs named by the signed pointer.
Use the owner-approved public root and the owner-approved APK certificate fingerprints from the
release records. Keep the approvals file separate from the signed feed so neither the display
mode nor its trust anchors come from the feed being checked. This build uses public material only.

```sh
node store/site/build.mjs --out <new-output-directory> \
  --release-dir <signed-input-directory> \
  --release-approvals <approved-public-pins.json> \
  --build-tools <Android-SDK-build-tools-version-directory>
```

The inputs directory contains `store-root.der`, `keys-envelope.json` and `pointer-envelope.json`.
The approvals JSON contains the pinned public root SHA-256 and a map from each package ID to its
approved APK signing certificate SHA-256:

```json
{
  "schema": "awai.store-site.approvals.v1",
  "rootSha256": "<64 lowercase hex characters>",
  "apkSigners": {
    "network.itonami.app": "<64 lowercase hex characters>"
  }
}
```

The production build applies the Android Store’s online pin rules and checks each signed Android
artifact’s asset path against the Android catalog. The signed catalog and APK downloads must use the
declared commit and release paths under
`store/distribution/rel-YYYYMMDD-rNNN/`. The build checks that every approved app has a signed
catalog entry, a pin and a local APK with matching size and digest. Android build tools verify the
APK signature, package, version code and non-debuggable manifest. The checked-in development root
and development APK identity are refused in this mode. A failed check prevents output generation.
The production manifest sets `development: false` and includes each APK’s version, bytes, hash and
verified signer. Build output does not upload or change the public site. The production publishing and device acceptance steps remain in the release procedure.

## Publishing

`store.itonami.app` is served by the name plane of the `yataverse-bytes` Worker (Cloudflare account
`cloud-kotoba`): the host's `_dnslink` TXT record names a UnixFS root, and the Worker returns the
files under it. Owner instruction 2026-11-21: publish through Cloudflare first, while the node
entrance is down. Steps and limits of the name plane are in `docs/name-plane-deploy-runbook.md` of
`network-awai/app-itonami-yataverse`; the record of the first publication is
[docs/otehon/itonami-store-web-entry-publication-20261121.md](../../docs/otehon/itonami-store-web-entry-publication-20261121.md).

```sh
node store/site/build.mjs --out <new directory>            # from a clean checkout of main
yataverse site-pack <that directory> -o <car directory>     # local; prints the root
yataverse car-put <car directory>/site-001.car              # writes the blocks, verifies the receipt
```

Then set the TXT record `_dnslink.store.itonami.app` to `dnslink=/ipfs/<root>` in the Cloudflare
dashboard (exactly one record; the local wrangler login cannot edit DNS), and compare each served
file with `site-manifest.json` by SHA-256. To take the page down, delete that record: the host then
answers `404 name-not-published`.

## Limits

- The pointer lasts 30 days. A page built from it is stale after that; rebuild after each new pointer.
- A changed catalog is caught by the digest pin before its signature is checked, so the test for a
  changed catalog reports `catalog-digest`.
- The build reads APK bytes from this repository. It does not fetch the pinned URLs, so it does not
  prove that GitHub serves the same bytes.
- CSS uses only Baseline Widely available features. The `modern-web-guidance` skill was not available
  in the sessions that wrote it.
- No font file is shipped. Devices without Noto Sans JP render with their own font.
