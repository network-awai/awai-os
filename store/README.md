# Store distribution (AWAI-3882)

Publisher metadata and the production release record for the Itonami Store.

## Publisher

The legal publisher is defined exactly once in
`store/catalog-source/series-apps.json` under the top-level `publisher` field
(`Awai Network LLC`). The string is never copied per app entry:

- Series apps: `android/series-catalog.py` writes that single value into every
  listed catalog entry. `check_table` refuses a table without a non-empty
  top-level publisher, refuses any per-entry `publisher` field, and fails
  closed if any entry does not resolve the publisher
  (`resolved_publisher()`); entry generation fails the same way. So adding a
  new app entry without a resolution aborts the run instead of emitting an
  unlabelled entry.
- Other built apps: `android/build.py` loads the same file once as `PUBLISHER`
  and references it for every built entry (Itonami, Yotei, Torihiki, Deai,
  Hiring, Shirohan and the remaining local/dapp entries). It never repeats the
  literal.
- Entry page: `store/site/build.mjs` shows each app's `publisher` from the
  signed catalog as 配布元 and writes the same value into
  `site-manifest.json`. The build never invents a publisher string, and it
  fails closed (`publisher`) if any catalog entry's publisher is missing or
  blank. `store/site/build.test.mjs` covers both: the detail view renders each
  publisher, and missing/blank publishers are rejected.
- Latest pointer: `store/latest/README.md` documents that the pointer carries
  the signed catalog entries, publisher included; production catalogs carry the
  publisher above.

Historical `store/distribution/dev-YYYYMMDD-rNNN/` catalogs keep the publisher
they were signed with (`Awai Otehon 開発版`, plus `Itonami Registry` for the
Registry Assoc entry). They are not rewritten; the new value applies to
catalogs generated after this change and to every `rel-` release.

## Signing keys

- The production signer and its keystore stay with the owner. They are never
  passed to CI and never written to this repository, a log, or a comment. No
  private key, keystore file, password or credential belongs here, in CI, or
  in any build input.
- This repository holds only the public key and chain: `store/keys/store-root.der`
  (development root public key), `store/latest/keys-envelope.json` (the
  root-signed key list), and `store/keys/dev-catalog-signer.pem` (the
  development APK signer certificate). See `store/keys/README.md`.
- Production deploy, billing and key generation are owner tasks. CI does not
  sign catalogs, pointers, or release records; GitHub Actions is stopped and is
  not wired to any key.

## Distribution order

Apps ship Store first, then Play: the Store entry page and the signed catalog
are the first channel; Google Play follows only after the Store release is
published and verified. The Play signing-key state is owner-held as above.

## Production releases (`rel-YYYYMMDD-rNNN`)

Production releases use `store/distribution/rel-YYYYMMDD-rNNN/` directories,
one per release. Existing `dev-YYYYMMDD-rNNN/` directories are immutable
history and are never modified.

Each release directory holds one release record file,
`store/distribution/rel-YYYYMMDD-rNNN/release.json`, that records, in that
single file:

- app name,
- `versionName`,
- `versionCode`,
- APK SHA-256,
- signer public key (the APK signer certificate SHA-256 fingerprint, read from
  the APK signature block; the public value only), and
- commit SHA (the commit the release was built from).

Template (one file per release, values for one app):

```json
{
  "publisher": "Awai Network LLC",
  "app": {"name": "Yotei", "versionName": "0.1.0", "versionCode": 1},
  "apkSha256": "<64 hex chars>",
  "signerPublicKeySha256": "<64 hex chars>",
  "commitSha": "<40 hex chars>"
}
```

`publisher` in a release record is read from the single definition in
`store/catalog-source/series-apps.json`, not retyped. The record names the
public signer fingerprint only; it never contains a private key, keystore, or
credential. The signed catalog envelope and the APK bytes for the release sit
alongside the record, and the `rel-` number increases monotonically with the
catalog revision. A `rel-` release that cannot produce this one-file record is
not a release yet.
