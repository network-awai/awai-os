# Latest Store catalog pointer (AWAI-3662)

`pointer-envelope.json` is the one mutable file the Store reads to find the newest signed catalog:
`https://raw.githubusercontent.com/network-awai/awai-os/main/store/latest/pointer-envelope.json`.

- Format `itonami.store.latest.v1`: `{raw, signature}`. `raw` holds `sequence`, `issuedAt`, `expiresAt` and `pins`. The pins have the same shape as `android/online-pins.dev.json`: commit-pinned URLs, SHA-256 and byte ceilings for the catalog and for each APK.
- Signed SHA256withRSA with a **pointer key** listed in the Store's key list (AWAI-3775): `keys-envelope.json`, signed by the development root `c3ad794d…` (see `store/keys/README.md`). From sequence 4 on, the development pointer key `8250a122…`; sequences 1 to 3 were signed by the debug key `2507930b…`, which Stores built since the key list no longer trust. There is no production key yet.
- The Store trusts it only after `LatestPointer.java` checks:
  - the signature against a pointer key in its key list (the bundled one, or a newer `keys-envelope.json` that verifies against the same root);
  - the schema;
  - that `sequence` is not below the highest sequence it has accepted;
  - that it has not expired, with a lifetime of at most 31 days;
  - that every URL is under `network-awai/awai-os/<commit>/store/distribution/` with no query or fragment;
  - that every app id is known and each byte ceiling is within that app's budget.

## Publishing a new pointer

1. Update `android/online-pins.dev.json` to the new catalog and APKs, or pass `--pins FILE`.
2. Run `python3 android/publish-latest-pointer.py --sequence N`, with N above the published value. By default it signs with the development pointer key in `~/.android/awai-store-dev`, refuses a key that the published list does not list for the pointer role, and checks the signature with openssl.
3. Commit `store/latest/pointer-envelope.json` to `main`.

A pointer lasts 30 days. **Re-sign it before it expires**; otherwise automatic updates stop.

Published:
- sequence 1 (2026-11-21, catalog r107 at `ed429b4`).
- sequence 2 (2026-11-21, catalog r108 at `89aeb54`, which declares the Torihiki operations). Expires 2026-12-21.
- sequence 3 (2026-11-21, catalog r109, which adds Shirohan 白版). Expires 2026-12-21.
- sequence 4 (2026-11-22, catalog r110 at `60c5e04`, signed by the development catalog key). First pointer signed by the development pointer key of the key list. Expires 2026-12-22.

## Key list

`keys-envelope.json` (`{raw, signature}`) is the root-signed list of catalog and pointer keys, read by the Store
from `https://raw.githubusercontent.com/network-awai/awai-os/main/store/latest/keys-envelope.json` before the
pointer, under the same standing update approval. A Store keeps the highest list sequence it has accepted and
refuses a lower one. Replacing or withdrawing a key is a new list with a higher sequence
(`android/key-list.py`).

**Stores built before the key list stop updating.** They trust only the debug key, so they refuse sequence 4 and
later. They are reinstalled (owner default 2026-11-22) by installing a current build over them with
`adb install -r`, which keeps their data and every other app (`docs/otehon/itonami-store-key-list-moto-g05-20261122.md`).

## Publisher (AWAI-3882)

The pointer carries no publisher of its own: each app's publisher comes from the signed catalog
it pins, and production catalogs write the single publisher defined once in
`store/catalog-source/series-apps.json` (`Awai Network LLC`). Development catalogs keep the
publisher they were signed with. See `store/README.md` for the key custody rule (production key
stays with the owner; this repository holds only the public key and chain), the Store-then-Play
order, and the `rel-YYYYMMDD-rNNN` one-file release record.
