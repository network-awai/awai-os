# Itonami Store development distribution, catalog revision 103 (AWAI-3320)

Revision 103 adds the Torihiki devnet viewer (`network.itonami.torihiki`) to revision 102, so it stays listed after a Store admits the online catalog. The Yotei, Itonami and Torihiki Bot entries are unchanged copies from `../dev-20261118/catalog-rev102-raw.json`. Their APKs stay in `../dev-20261116/` and `../dev-20261118/`.

| File | Contents |
| -- | -- |
| `catalog-rev103-raw.json` | Exact UTF-8 bytes that were signed (compact JSON, no trailing newline). |
| `catalog-envelope.json` | `{raw, signature}`: SHA256withRSA over `raw` with the existing Android development debug key (`android/SignCatalog.java`, signer certificate `2507930b…`). The private key is not in the repository. 3,438 bytes, sha256 `62d1958c561f910c06e8dde26dd0f5ac321ba69ce78b574708dd4ef1e7392228`. |
| `torihiki.apk` | `network.itonami.torihiki` 1 / 0.1.0, built with `android/build.py --version 1` from awai-os `e7fe327`, which includes AWAI-491 devnet orders. 4,206,342 bytes, sha256 `0717795a3c05934d70a7791edaa2848d8264210ba1af6e2b2d01f0429a7cf86f`. Its entry is copied from that build's bundled catalog. |

The catalog expires 30 days after signing (`expiresAt` 1797554690). It is a development preview with no production key, rotation or revocation.

The storage guard stopped that build at its free-space floor while it was building the Store and Home APKs, after the Torihiki APK was finished. `apksigner verify` passes on the Torihiki APK, and `aapt2` reports the package as `network.itonami.torihiki` versionCode 1.

## Checks at signing (2026-11-18)

- `openssl dgst -sha256 -verify` with the debug public key: Verified OK.
- `authenticateCatalog` (`android/client/online.js`, the compiled domain and the real key) accepts revision 103 with Yotei@4, Itonami@1000, Torihiki Bot@1000 and Torihiki@1.
- A changed byte count, a dropped entry, a swapped asset and a revision floor of 104 are each refused.
