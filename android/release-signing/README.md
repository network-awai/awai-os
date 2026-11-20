# Verify an Awai OS PC image

The PC download bundle comprises an image, its release manifest and the
detached signature for that manifest. The manifest pins the image filename,
byte count, SHA-256 digest and source revision. The expected public key should
come from a trusted copy of this repository, independently of the download.

Install Node.js and place the downloaded image in the specified directory.

```sh
node android/release-signing/manifest.mjs verify-pc \
  ./download/manifest.json ./download/manifest.sig \
  android/release-signing/keys/release-2026-11.pub ./download
```

Successful verification reports `signatureVerified: true`, `filesVerified: true`
and one image. If the command exits with an error, reacquire and verify the
bundle before installing it.

For release preparation, record the qualified image and full source revision:

```sh
node android/release-signing/manifest.mjs make-pc \
  ./candidate/awai-os-pc.iso "$source_revision" ./candidate/manifest.json
```

Sign the manifest bytes using the existing Ed25519 release-signing workflow.
Run `verify-pc` against the exact bytes destined for distribution. The image
qualification, Android platform/AVB/OTA signatures and public download
readback each have their own acceptance criteria. Release tracking is in
[AWAI-3062](https://linear.app/kotobalabs/issue/AWAI-3062).

The `make` and `verify` commands remain available for the
[derived development image](../desktop/derived-image/README.md).

## Stage the unsigned archive before local signing

Run the keyless preparation on the build host and use the unsigned SHA-256 from
the build record. The host needs Python 3 and Info-ZIP `zip`.

```sh
python3 android/release-signing/prepare-target-files.py \
    "$UNSIGNED_TARGET_FILES" "$PREPARED_TARGET_FILES" \
    --source-sha256 "$UNSIGNED_TARGET_FILES_SHA256"
```

The script adds the `avbtool` selector if it is absent so that releasetools can
sign APEX payloads. It checks the non-metadata ZIP member inventory after the
update. The selector leaves the product's AVB policy unchanged. Record both
hashes and verify the prepared hash after transfer to the Mac. Transfer only
the prepared archive for this step, then use the existing local Keychain
signing and certificate verification flow.
