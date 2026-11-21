# Latest Store catalog pointer (AWAI-3662)

`pointer-envelope.json` is the one mutable file the Store reads to find the newest signed catalog:
`https://raw.githubusercontent.com/network-awai/awai-os/main/store/latest/pointer-envelope.json`.

- Format `itonami.store.latest.v1`: `{raw, signature}`. `raw` holds `sequence`, `issuedAt`, `expiresAt` and `pins`. The pins have the same shape as `android/online-pins.dev.json`: commit-pinned URLs, SHA-256 and byte ceilings for the catalog and for each APK.
- Signed SHA256withRSA with the **development** debug key (signer `2507930b…`), the same key as the development catalogs. There is no production key yet.
- The Store trusts it only after `LatestPointer.java` checks:
  - the signature against the pinned key;
  - the schema;
  - that `sequence` is not below the highest sequence it has accepted;
  - that it has not expired, with a lifetime of at most 31 days;
  - that every URL is under `network-awai/awai-os/<commit>/store/distribution/` with no query or fragment;
  - that every app id is known and each byte ceiling is within that app's budget.

## Publishing a new pointer

1. Update `android/online-pins.dev.json` to the new catalog and APKs, or pass `--pins FILE`.
2. Run `python3 android/publish-latest-pointer.py --sequence N`, with N above the published value. It refuses a different signer and checks the signature with openssl.
3. Commit `store/latest/pointer-envelope.json` to `main`.

A pointer lasts 30 days. **Re-sign it before it expires**; otherwise automatic updates stop.

Published:
- sequence 1 (2026-11-21, catalog r107 at `ed429b4`).
- sequence 2 (2026-11-21, catalog r108 at `89aeb54`, which declares the Torihiki operations). Expires 2026-12-21.
- sequence 3 (2026-11-21, catalog r109, which adds Shirohan 白版). Expires 2026-12-21.
