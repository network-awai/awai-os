# Itonami Store development distribution, catalog revision 102 (AWAI-3313)

Revision 102 adds Torihiki Bot to revision 101 (Yotei and Itonami). The Yotei and Itonami entries are unchanged copies from `../dev-20261116/catalog-rev101-raw.json`, and their APKs stay in `../dev-20261116/`.

| File | Contents |
| -- | -- |
| `catalog-rev102-raw.json` | Exact UTF-8 bytes that were signed (compact JSON, no trailing newline). |
| `catalog-envelope.json` | `{raw, signature}`: SHA256withRSA over `raw`, signed with the existing Android development debug key (`android/SignCatalog.java`, signer certificate `2507930b…`). The private key is not in the repository. 2,749 bytes, sha256 `047d549e7ac883621e7f4c7b766e38274740a6598f2732ea94b1d6e558f2fe55`. |
| `torihiki-bot.apk` | `network.itonami.torihiki.bot` 1000 / 0.1.0, arm64 Tauri v3 debug build of network-awai/app-itonami-torihiki `app/` (AWAI-3258). 29,506,324 bytes, sha256 `797013c7abbd395eb09a75551838018a90211864b7012d0d7ccba1326556f99c`. |

The catalog expires 30 days after signing (`expiresAt` 1797552917). This is a development preview: no production key, rotation or revocation, and no mutable "latest" channel. The Torihiki devnet viewer (`network.itonami.torihiki`) is not in the online catalog; when a Store admits this catalog, only the listed apps are shown.

## Checks at signing (2026-11-18)

- `openssl dgst -sha256 -verify` with the debug public key: Verified OK.
- The repository path `authenticateCatalog` (`android/client/online.js`, the compiled domain and the real key) accepts revision 102 with Yotei@4, Itonami@1000 and Torihiki Bot@1000. A changed byte count, a dropped entry, a swapped asset and a revision floor of 103 are each refused.
