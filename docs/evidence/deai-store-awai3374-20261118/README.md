# Deai in the bundled Store (AWAI-3374, 2026-11-18)

Source, build and disposable-emulator evidence only. Nothing here proves a physical-device Store install, production signing, online catalog publication, a custom ROM, a signed OTA or Native selfhost.

## Input

- APK: network-awai/app-deai at `440b943` (AWAI-3373, PR #10), Tauri v3 arm64 debug build of `awai/`.
- `network.itonami.deai`, versionCode 1000, versionName 0.1.0, minSdk 24, targetSdk 37.
- 20,782,497 bytes, sha256 `c34527953fe95ddfe1c43c061b39be9b15db9a653116146942d4ed07cb50cffe`.
- One signer, the local Android debug key (`2507930b…5b49b29`): the same development identity as the other Store apps.
- `aapt2 dump badging` lists only the AndroidX-internal `network.itonami.deai.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`; no `android.permission.INTERNET`.

## Source and build

- `node --test` on each `android/tests/*.test.mjs`: 25 pass. The new domain test admits a 30 MiB `packages/deai.apk` and refuses three other asset names.
- `python3 android/build.py --version 1 --itonami-apk store/distribution/dev-20261116/itonami.apk --deai-apk <apk>`: passed. The signed bundled catalog lists `network.itonami.deai` 0.1.0 with the APK's own size and digest. `otehon/shell` needed `npm ci` from its lockfile first (`esbuild` for `build-identity.mjs`).
- Negative control: `--deai-apk store/distribution/dev-20261116/itonami.apk` stops with `deai APK package is not network.itonami.deai`. The build also stops if the APK requests INTERNET or its signer is not exactly the development identity (not exercised with a real APK).
- `python3 android/build-tests.py --version 1`: passed.

## Disposable emulator

`sdk_phone64_arm64` Android 15 (`AE3A.240806.019`, userdebug, test-keys), AVD `Awai_Deai_AWAI3178` started with `-wipe-data` on port 5780. The Store's "install unknown apps" permission was granted with `appops` on this test emulator.

| Step | Result | Evidence |
| -- | -- | -- |
| `StoreInstrumentation` | 14 assertions passed. These include `verifiedApk("network.itonami.deai")`, which checks bytes, sha256, package, versionCode and signer. | — |
| Store list | Deai is listed as v0.1.0 · 同梱アプリ. | `store-02-list.jpg` |
| Detail | 「出会いの準備を、手元で。」, 端末内で使える, and the catalog description (on the device only, no sending, no remote inference, no contact between users). | `store-04-detail.jpg` |
| Pre-add disclosure | 送る情報: 外部への送信なし; 許可の範囲: 今回の端末への追加1回. | `store-05-disclosure.jpg` |
| Store integrity dialog | Shows the sha256 above before Android's installer opens. | `store-07-integrity.jpg` |
| Android install and launch | **Not verified.** After 今回の追加に進む the host load rose to 92–112 and adb stopped responding; the emulator was stopped. | — |

## Known gaps

- Android's installer step and the first launch of `network.itonami.deai` have not been observed on any device. The app itself was checked on a moto g05 and an emulator under its previous id `network.awai.deai.dev.debug` (network-awai/app-deai `awai/docs/acceptance-20261118.md`).
- The Store on the owner's moto g05 was not replaced: it is a newer Store build (versionCode 5) whose catalog includes apps this build was not given.
- The app uses Tauri's default launcher icon and the Store shows the generic apps icon.
