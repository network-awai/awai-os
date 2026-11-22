# Itonami Store development catalog r108 (AWAI-3653)

r108 is r107 with two changes: the Torihiki and Torihiki Bot entries now declare their external
operations (`operations`), and the revision and expiry are new. Every entry, version, artifact and
APK is unchanged from r107, and the APKs stay in their earlier directories.

`operations` is what the Store's automatic update compares (condition 5, "no new external
operation, endpoint origin or data category"). An app that requests `INTERNET` can be updated
without asking only when both the installed version and the new version have a declared list, and
the new list adds nothing.

Each item has the form `service|origin|operation|METHOD:path?query-names|data-categories`, with the data
categories sorted. They were read from the published artifacts, not from current source:

- `network.itonami.torihiki` 1 (`dev-20261118-r103/torihiki.apk`): `assets/torihiki.js` in that
  APK declares 7 operations on the devnet node: 4 reads, plus `POST /tx` for devnet funds, orders and
  cancel-all. Current awai-os source adds trades and candle reads. A rebuilt viewer will therefore
  declare new operations and still ask.
- `network.itonami.torihiki.bot` 1000 (`dev-20261118/torihiki-bot.apk`): built from
  network-awai/app-itonami-torihiki `ffbc87e` (the only commit touching `app/`).
  `app/src/torihiki_app/domain.cljc` declares 2 reads of `bots.itonami.cloud` and 3 reads of the
  devnet node. The APK's Tauri CSP `connect-src` lists the same two origins.

| File | Contents |
| -- | -- |
| `catalog-rev108-raw.json` | the exact UTF-8 bytes that were signed (6,209 bytes) |
| `catalog-envelope.json` | `{raw, signature}`, SHA256withRSA with the development debug key (signer `2507930b…`), 6,988 bytes, sha256 `6ba2b4a5a792be2ac4202a8301ac3a5340dc22246f54b26a17734bb5dbeb3e2a` |

Expires 30 days after signing (`expiresAt` 1797828470, 2026-12-21). Development preview: no
production key, rotation or revocation.

Note for the first automatic update: the Store records an app's operations when it installs that
app. A Torihiki installed before this catalog has no record, so its next update still asks once.
After that, updates that add nothing can install without asking.

Checks at signing (2026-11-21): `openssl dgst -sha256 -verify` with the debug public key gave
Verified OK, and the shared domain's `validCatalog` accepts the raw bytes.
