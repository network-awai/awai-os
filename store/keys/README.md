# Store keys (public only)

No private key belongs in this directory or anywhere in this repository.

## Key list root (AWAI-3775)

`store-root.der` is the public key (X.509 SubjectPublicKeyInfo, DER) of the **development** root that signs the
Store's key list. Every Store built from this repository pins it; the list itself is published at
`store/latest/keys-envelope.json` and bundled into each build. Key IDs are the SHA-256 of the SubjectPublicKeyInfo.

| Role | Key ID | Since |
|---|---|---|
| root | `8707b4bbca6d14338f6ef29e816a2141594b7f9a9e70f338258b00682bec0e5b` | list sequence 2, 2026-11-23 |
| catalog | `73e8cf0d0ac997713adc296a25a96ce49755768a6327ded41e45621e2e0f5189` | list sequence 2 |
| pointer | `c158736823262a44c3832bafcb8da394a2f2eb24bd510aa44b8328dc3ca80e5d` | list sequence 2 |

All three are RSA 3072 development keys (owner default 2026-11-22: development catalogs and pointers use a
development root and role keys; development APKs stay signed by the Android debug key). Production Stores will
pin a different root. The list expires 2027-05-22 (sequence 2, 180 days); the root must sign a new list before
then, and at most every 190 days.

## Re-root (sequence 2, 2026-11-23)

The private key of the sequence-1 root (`c3ad794d52bdc3f79693a70b6b6b2a68ae2430f068b14c52851a6431b684c436`)
was never found — only the public key was kept — so new lists could not be signed. Sequence 2 re-roots the
Store on a new root generated on the development Mac: the old root is retired, and the sequence-1 catalog
(`82522d92…`) and pointer (`8250a122…`) keys are no longer listed. The new role keys are listed in the
sequence-2 list; the retired SPKI values stay in the test `android/tests/key-list-reroot.test.mjs`, which
asserts the published sequence-2 list verifies under the new root and is refused (`keys-signature`) under the
retired root.

Impact on already-built development Stores: the root is pinned in the build
(`store/keys/store-root.der`, bundled as `assets/store-root.der`). A Store built before this change verifies
the published list against the retired root, so the sequence-2 list fails there (`keys-signature`) and it keeps
trusting its bundled sequence-1 list. Until it is rebuilt and reinstalled (owner default 2026-11-22:
`adb install -r` of a fresh build keeps data), it will not follow the new catalog and pointer keys.
The same applies to every development app that bundles this root. Production Stores pin a different root
and are unaffected. The follow-up publication has now landed: catalog r114 (first catalog signed by the new
catalog key `73e8cf0d…`) and pointer sequence 5 (first pointer signed by the new pointer key `c1587368…`),
carrying forward the 17 pinned apps unchanged — so a new-root Store can update from it, while an old-root-pinned
Store still needs the rebuild above. Existing `store/distribution` revisions (r112/r113) are unchanged;
r114 only adds the new envelope.

The private keys are on the development Mac in `~/.android/awai-store-dev/` (`root.p12`, `catalog.p12`,
`pointer.p12`, password file `password`, all 0600), next to Android's own debug keystore. `android/build.py`
and `android/publish-latest-pointer.py` read the catalog and pointer keys from there by default; without them a
build stops and asks for `--key-list` and `--catalog-keystore`. Signing a new list:

```sh
python3 android/key-list.py export --keystore ~/.android/awai-store-dev/catalog.p12 --alias catalog --pass-env VAR --out catalog.der
python3 android/key-list.py prepare --sequence N --catalog-key catalog.der --pointer-key pointer.der --out keys.txt
python3 android/key-list.py sign --list keys.txt --expected-sha256 <from prepare> --keystore ~/.android/awai-store-dev/root.p12 \
  --alias root --pass-env VAR --expected-root 8707b4bbca6d14338f6ef29e816a2141594b7f9a9e70f338258b00682bec0e5b --out-dir OUT
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
