# Itonami Store development distribution, catalog revision 104 (AWAI-3397)

Revision 104 adds Deai (`network.itonami.deai`) to revision 103. The Yotei, Itonami, Torihiki Bot and Torihiki entries are unchanged copies from `../dev-20261118-r103/catalog-rev103-raw.json`. Their APKs stay in `../dev-20261116/`, `../dev-20261118/` and `../dev-20261118-r103/`.

| File | Contents |
| -- | -- |
| `catalog-rev104-raw.json` | Exact UTF-8 bytes that were signed (compact JSON, no trailing newline). 3,556 bytes. |
| `catalog-envelope.json` | `{raw, signature}`: SHA256withRSA over `raw` with the existing Android development debug key (`android/SignCatalog.java`, signer certificate `2507930b…`). The private key is not in the repository. 4,207 bytes, sha256 `f7f18c4eca72a078b48bb339217b2ad23d5505bed5b706e0f769a3508b17fa38`. |
| `deai.apk` | `network.itonami.deai` 1000 / 0.1.0, the Tauri v3 debug build of network-awai/app-deai `440b943` (AWAI-3373). 20,782,497 bytes, sha256 `c34527953fe95ddfe1c43c061b39be9b15db9a653116146942d4ed07cb50cffe`, signed with the development identity, no INTERNET permission. Its entry is copied from the bundled catalog that `android/build.py --deai-apk` wrote for AWAI-3374. |

The catalog expires 30 days after signing (`expiresAt` 1797566165). It is a development preview with no production key, rotation or revocation.

## Checks at signing (2026-11-18)

- `openssl dgst -sha256 -verify` with the debug public key: Verified OK.
- `authenticateCatalog` (`android/client/online.js`, the compiled domain and the real key) accepts revision 104 with Yotei@4, Itonami@1000, Torihiki Bot@1000, Torihiki@1 and Deai@1000.
- A changed byte count, a dropped entry, a swapped asset and a revision floor of 105 are each refused.
