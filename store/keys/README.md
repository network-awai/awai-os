# Store keys (public only)

No private key belongs in this directory or anywhere in this repository.

## Key list root (AWAI-3775)

`store-root.der` is the public key (X.509 SubjectPublicKeyInfo, DER) of the **development** root that signs the
Store's key list. Every Store built from this repository pins it; the list itself is published at
`store/latest/keys-envelope.json` and bundled into each build. Key IDs are the SHA-256 of the SubjectPublicKeyInfo.

| Role | Key ID | Since |
|---|---|---|
| root | `c3ad794d52bdc3f79693a70b6b6b2a68ae2430f068b14c52851a6431b684c436` | list sequence 1, 2026-11-22 |
| catalog | `82522d92d054acdd08b31ef71c9a15c9bf2c6d76b9ee75c47b4fcfe077196449` | list sequence 1 |
| pointer | `8250a1229ddbc01d18baed34cfee7239d3969539e4bd1401495ab92c86d20a8a` | list sequence 1 |

All three are RSA 3072 development keys (owner default 2026-11-22: development catalogs and pointers use a
development root and role keys; development APKs stay signed by the Android debug key). Production Stores will
pin a different root. The list expires 2027-05-21 (sequence 1, 180 days); the root must sign a new list before
then, and at most every 190 days.

The private keys are on the development Mac in `~/.android/awai-store-dev/` (`root.p12`, `catalog.p12`,
`pointer.p12`, password file `password`, all 0600), next to Android's own debug keystore. `android/build.py`
and `android/publish-latest-pointer.py` read the catalog and pointer keys from there by default; without them a
build stops and asks for `--key-list` and `--catalog-keystore`. Signing a new list:

```sh
python3 android/key-list.py export --keystore ~/.android/awai-store-dev/catalog.p12 --alias catalog --pass-env VAR --out catalog.der
python3 android/key-list.py prepare --sequence N --catalog-key catalog.der --pointer-key pointer.der --out keys.txt
python3 android/key-list.py sign --list keys.txt --expected-sha256 <from prepare> --keystore ~/.android/awai-store-dev/root.p12 \
  --alias root --pass-env VAR --expected-root c3ad794d52bdc3f79693a70b6b6b2a68ae2430f068b14c52851a6431b684c436 --out-dir OUT
cp OUT/keys-envelope.json store/latest/keys-envelope.json
```

## APK signer certificate

`dev-catalog-signer.pem` is the public X.509 certificate of the **development** identity that signs the
development APKs (and, before AWAI-3775, also signed the catalogs and the pointer). SHA-256 of the DER:
`2507930b6c21b3c1cd0655527227dba75772096eff85e887bfcce2fb25b49b29`. The entry page uses this fingerprint only to
label an APK as signed by the development key.

It was taken from the signature block of the published
`store/distribution/dev-20261121-r109/shirohan.apk` (AWAI-3730):

```sh
unzip -p store/distribution/dev-20261121-r109/shirohan.apk META-INF/ANDROIDD.RSA \
  | openssl pkcs7 -inform DER -print_certs
openssl x509 -in store/keys/dev-catalog-signer.pem -outform DER | shasum -a 256
```

This is an Android debug certificate. It is not a production publisher key.
