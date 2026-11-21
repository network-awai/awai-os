# Itonami Store entry page (AWAI-3730)

`build.mjs` generates the static entry page for the Itonami Store from the signed latest pointer
(`store/latest/pointer-envelope.json`). The chosen host is `store.itonami.app` (owner decision
2026-11-21, AWAI-3731). This directory does not deploy anything.

```sh
node --test store/site/build.test.mjs
node store/site/build.mjs --out <new directory>
```

Output: `index.html`, `style.css` and `site-manifest.json` (`awai.store-site.v1`, with the SHA-256
of each file, the pointer sequence, the catalog revision and each listed APK).

## What the build checks

An app is listed with a download link only when all of these hold. Any failure stops the build.

- The signer certificate (`store/keys/dev-catalog-signer.pem`) has the pinned SHA-256 fingerprint.
- The pointer envelope is signed by that key (SHA256withRSA), has the `itonami.store.latest.v1`
  schema, a lifetime of at most 31 days, and has not expired.
- Every pinned URL is a commit-pinned `raw.githubusercontent.com/network-awai/awai-os/<commit>/store/distribution/…` URL.
- The catalog envelope in this repository has the pinned SHA-256 and size, is signed by the same key,
  has the `itonami.store.bundled.v1` schema, and has not expired.
- Each APK pin equals the catalog's SHA-256 for that app, and no pin names an unlisted app.
- Each APK present in this repository has the catalog's size and SHA-256.

## What the page is

- A document: HTML and CSS only. No script, no form, no image, no remote subresource. The
  `Content-Security-Policy` meta is `default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'`.
- The page sends nothing until the person follows a link. Each download link names its host and
  shows the SHA-256 and signer next to it. There is no request-time handler, per-user state or proxy.
- It says that this is a development build. The catalog and most APKs are signed with the Android
  debug identity; there is no production publisher key, rotation or revocation yet (AWAI-2982, AWAI-3732).
- It does not offer the Store APK itself, an iOS build or a desktop build. None is published.

## Limits

- The pointer lasts 30 days. A page built from it is stale after that; rebuild after each new pointer.
- A changed catalog is caught by the digest pin before its signature is checked, so the test for a
  changed catalog reports `catalog-digest`.
- The build reads APK bytes from this repository. It does not fetch the pinned URLs, so it does not
  prove that GitHub serves the same bytes.
- CSS uses only Baseline Widely available features. The `modern-web-guidance` skill was not available
  in the session that wrote it.
