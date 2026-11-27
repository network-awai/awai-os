# Derived development image (AWAI-3067)

A PC image made by adding the Awai Home and Store apps and the DP-1 display setting to
the pinned PC Live image, then recording the result in a manifest signed with the Awai
release key. It is for development and verification. It is **not an Awai OS release**:
it derives from a third-party prebuilt image, so it must not be published or branded as
Awai OS. The real release is the source build in
[AWAI-3061](https://linear.app/kotobalabs/issue/AWAI-3061).

## What changes

| Image | Change |
| --- | --- |
| `system.img` | Adds `/system/product/app/AwaiHome` and `AwaiStore` as product apps (v15, built from this repository), labelled `system_file` like the base's own product apps. Yotei is not preinstalled; it is installed from the Store (AWAI-4094) |
| `vendor.img` | Appends `vendor.hwc.drm.primary_display=DP-1` to `build.prop`, so DP-1 is the primary display without a kernel argument |
| everything else | Copied unchanged: kernel, ramdisk, `system_dlkm`, `vendor_dlkm`, firmware |

All other files in system and vendor keep their content, mode, owner and SELinux
label. The one exception is symlink permission bits, which become `0777`: Linux
always creates symlinks that way, and neither Linux nor Android checks them.
[tree-diff-20261117.json](evidence/tree-diff-20261117.json) records the comparison:
- system: 7,489 base entries, 6 added paths, no other change
- vendor: only `build.prop` changed

That comparison, and [vm-boot-20261117.json](evidence/vm-boot-20261117.json) /
[desktop-boot-20261117.json](evidence/desktop-boot-20261117.json), are the **2026-11-17
image with three apps**. They are history and are not rewritten. The current input is
Home and Store only (2026-11-25, AWAI-4094); no image was rebuilt in this change.

The Awai apps are system apps, but with the 2026-11-17 v15 APKs Home still becomes the
default launcher only when the user chooses it. The platform's own APK signatures are
untouched: replacing them needs the source build's target files.

Default home input (AWAI-4094, 2026-11-25): the pinned platform has no resource that
names a default HOME role holder. Home is a normal `product/app` prebuilt and the platform
caps a non-privileged HOME filter's priority above 0 back to 0
(`ComponentResolver.adjustPriority`, pinned `frameworks/base` `0a607d06`,
`ComponentResolver.java:493-515`), so `android/build.py` declares **no** priority on Awai
Home's HOME filter and
[`launcher3-home-priority-fallback.patch`](../pc-ab-device/patches/launcher3-home-priority-fallback.patch)
lowers Launcher3's HOME filter to `-1`. On a fresh `/data` the order is setup wizard 9
(Organizer's 6600H observation) > Awai Home 0 > Launcher3 -1 > Settings `FallbackHome`
-1000, so the fallback resolves without any privilege. The mechanism, evidence,
acceptance list and the unrun checks are in
[home-default-20261125.md](../pc-ab-device/home-default-20261125.md). The v15 APKs and any
image built before this change keep the old behaviour, so the image needs a rebuild from
the patched source tree with current APKs.
Launcher3 stays installed and becomes the HOME holder again when Awai Home is not
installed; if Awai Home stays installed but fails to start, the holder stays on it and
the recovery is Settings → Default apps → Home app.

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

APK signing is a separate identity. `android/build.py` signs the APKs with
`~/.android/debug.keystore` (alias `androiddebugkey`) unless `--keystore` is given
(`android/build.py:15,81,237`); `--release` refuses the Android debug identity and a
debuggable APK (`:114-117,239-243`). The v15 APKs' signer is not recorded by this
repository's evidence: `awai-manifest.json` pins only their bytes and SHA-256, so the
signer of those files is unverified here (no APK is present in the working tree to run
`apksigner verify --print-certs`). The release key does not sign the APKs, and neither do
the base image's platform/AVB keys: `build-images.sh` only adds app files and the vendor
property, and [tree-diff-20261117.json](evidence/tree-diff-20261117.json) records 6 added
system paths and `build.prop` as the only vendor change, so the base's
`framework-res.apk` and its platform signature stay untouched.

## Testing status and remaining work

- **Desktop boot test.** Done on 2026-11-17 in RAM Live mode, after the same path booted in a VM:
  the Desktop booted the derived images from a read-only NBD export with tmpfs `/data` and no
  local disk visible. Home, Store and Yotei ran as system apps, and DP-1 was the primary display
  without a `video=` argument. Only DP-1 had a monitor, so DP-1 winning over a connected HDMI
  display is not shown. See [desktop-boot-20261117.json](evidence/desktop-boot-20261117.json),
  [vm-boot-20261117.json](evidence/vm-boot-20261117.json) and the screenshots in `evidence/`.
  That run does **not** cover the default HOME role: `vm-boot-20261117.json` records it as not
  verified, and Home was opened explicitly. The persistence route with these images is not
  tested: its `verify-images.sh` pins the base digests, so it needs new pins first.
- **Two-app input (AWAI-4094).** Not built. The input now lists Home and Store only; the
  default-home input (no Home priority, Launcher3 `-1`) needs an image rebuilt from the
  patched source tree with current APKs, not the v15 APKs. Acceptance steps and the
  acceptance list are in
  [home-default-20261125.md](../pc-ab-device/home-default-20261125.md).
- **More apps.** Itonami, Murakumo and Drive (Tauri apps) are not included yet. Yotei is not
  preinstalled; it is installed from the Store's own catalog.
- **Publishing.** The images are not published anywhere, and must not be released
  as Awai OS.
