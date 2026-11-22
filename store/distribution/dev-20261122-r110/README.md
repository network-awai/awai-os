# Itonami Store development catalog r110

r110 carries forward the eight entries of r109 unchanged (same ids, versions, operations and exact APK
digests; the APKs stay in their earlier directories) with revision 110 and a new expiry
(`expiresAt` 1800470357, 2027-01-20).

It is the first catalog signed by the development **catalog key** of the Store's key list (AWAI-3775)
instead of the single development key that also signs the APKs:

- catalog key ID (SHA-256 of the SubjectPublicKeyInfo): `82522d92d054acdd08b31ef71c9a15c9bf2c6d76b9ee75c47b4fcfe077196449`
- listed in the development key list (sequence 1) under root `c3ad794d52bdc3f79693a70b6b6b2a68ae2430f068b14c52851a6431b684c436`

Signed with `python3 android/sign-catalog-envelope.py` (the key must be listed for the catalog role).
The bytes of `catalog-rev110-raw.json` are preserved verbatim in `catalog-envelope.json`.
Stores built before the key list cannot verify this catalog; the pointer that refers to it is published
separately. Development keys only: production Stores never trust this root.
