# Itonami Store development catalog r114 (AWAI-3775, key-list re-root)

r114 carries forward the seventeen entries of r113 unchanged (same ids, versions, operations and exact APK
digests) with revision 114. No APK changed, so no APK is copied into this directory; each APK still lives in
the rev that introduced it (r106–r113). The catalog raw (`catalog-rev114-raw.json`) is identical to r113's
except revision 114; `expiresAt` is carried over from r113 unchanged (2026-12-22).

Signing: the catalog envelope (`catalog-envelope.json`) is the first catalog signed by the **new development
catalog key** (`73e8cf0d0ac997713adc296a25a96ce49755768a6327ded41e45621e2e0f5189`, RSA 3072, listed in key
list sequence 2), after the key list was re-rooted at sequence 2 because the sequence-1 root private key was
never found. It is verified with the Store's key-list rules (new root accepts, retired root `c3ad794d…`
refuses) in `android/tests/r114.test.mjs`. The APKs themselves keep their existing signers (release-signed
creator APKs under `CN=AWAI Release, O=AWAI, C=JP` and the development identity below); only the catalog
envelope signature chain changed.

Nothing here is deployed or installed by this change: `store/distribution/` revs r112/r113 are untouched and
immutable. Publishing the next pointer (sequence 5) is a separate commit in the same PR; after merge the pins
revision is re-pointed at the merge head in a follow-up, as was done after the creator batch (#474).
