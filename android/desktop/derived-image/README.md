# Derived development image (AWAI-3067)

A PC image made by adding the Awai apps and the DP-1 display setting to the pinned
PC Live image, then signing the result with the Awai release key. It is for
development and verification. It is **not an Awai OS release**: it derives from a
third-party prebuilt image, so it must not be published or branded as Awai OS. The
real release is the source build in [AWAI-3061](https://linear.app/kotobalabs/issue/AWAI-3061).

## What changes

| Image | Change |
| --- | --- |
| `system.img` | Adds `/system/product/app/AwaiHome`, `AwaiStore` and `AwaiYotei` as product apps (v15, built from this repository), labelled `system_file` like the base's own product apps |
| `vendor.img` | Appends `vendor.hwc.drm.primary_display=DP-1` to `build.prop`, so DP-1 is the primary display without a kernel argument |
| everything else | Copied unchanged: kernel, ramdisk, `system_dlkm`, `vendor_dlkm`, firmware |

All other files in system and vendor keep their content, mode, owner and SELinux
label. The one exception is symlink permission bits, which become `0777`: Linux
always creates symlinks that way, and neither Linux nor Android checks them.
[tree-diff-20261117.json](evidence/tree-diff-20261117.json) records the comparison:
- system: 7,489 base entries, 6 added paths, no other change
- vendor: only `build.prop` changed

The Awai apps are system apps, but Home still becomes the default launcher only when
the user chooses it. The platform's own APK signatures are untouched: replacing them
needs the source build's target files.

## Build

The inputs are the pinned PC Live ISO (`isoSha256` in
[artifacts-20261116.json](../netboot/artifacts-20261116.json)) and the APKs from
`python3 android/build.py --version 15 --skip-cljs --out <dir>`.
1. Extract `android-Generic_x86_64/` from the ISO.
2. On Linux, as root, with `erofs-utils` and `attr` installed, run:

```sh
sudo bash android/desktop/derived-image/build-images.sh <extracted-dir> <apk-dir> <new-output-dir>
```

The script:
- refuses base images that don't match the pinned digests
- mounts the originals read-only
- adds the apps and the property, and rebuilds EROFS with a 4 KiB block size, LZ4HC
  compression, a fixed timestamp and the base UUIDs
- compares old and new trees with `compare-trees.py`
- writes `SHA256SUMS`

Two runs on 2026-11-17 produced byte-identical images. That run used a disposable
Lima VM on the operator Mac: Ubuntu 24.04 arm64, kernel 6.8, erofs-utils 1.7.1.

## Signing

The Awai release key is an Ed25519 key in macOS Keychain (service
`network.awai.os.release-signing.v1`, id `release-2026-11`). It is stored
this-device-only and not synchronised. Its public key is
[keys/release-2026-11.pub](../../release-signing/keys/release-2026-11.pub). The key
signs the release manifest, which pins every image's size and SHA-256, the base
pins and the derivation inputs. Android's platform, OTA and AVB keys are a separate
set that the source build will generate.

```sh
xcrun swiftc -O android/release-signing/AwaiReleaseSigner.swift -o <signer>
node android/release-signing/manifest.mjs make <image-dir> <build-report.json> <full-source-revision> <manifest.json>
<signer> sign release-2026-11 <manifest.json> > <manifest.json>.sig
node android/release-signing/manifest.mjs verify <manifest.json> <manifest.json>.sig android/release-signing/keys/release-2026-11.pub [image-dir]
```

Verification needs only the public key. On 2026-11-17 these all behaved as expected:
- the signed manifest and all 7 image digests verified
- an edited manifest failed the signature
- an image with one changed byte failed its digest

The signed manifest is [evidence/awai-manifest.json](evidence/awai-manifest.json),
and its signature is [evidence/awai-manifest.json.sig](evidence/awai-manifest.json.sig).

## Not done

- **Boot test.** These images have not been booted. To try them on the Desktop:
  - Use them in place of the base images in the [LAN Live route](../netboot/README.md),
    or as the NVMe copies in the [persistence route](../persistence/README.md).
  - The persistence route's `verify-images.sh` pins the base digests, so it needs
    new pins first.
  - Coordinate device time with the other sessions using the Desktop first.
- **More apps.** Itonami, Murakumo and Drive (Tauri apps) are not included yet.
- **Publishing.** The images are not published anywhere, and must not be released
  as Awai OS.
