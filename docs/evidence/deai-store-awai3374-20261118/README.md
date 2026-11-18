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
| Android install | Android's installer asked "Do you want to install this app?" and installed it. `installerPackageName=network.awai.store`, versionCode 1000, uid 10150, no INTERNET permission. | `store-08-installer.jpg` |
| Launch | `network.itonami.deai/.MainActivity` resumed (`am start -W` TotalTime 1,880 ms); the assistant status panel shows 「この端末だけ」 and 「なし（宣言された外部操作 0 件）」. | `store-10-launched.jpg` |
| Profile → ranking | Through WebView DevTools `Input.insertText` and clicks: interests 映画、散歩、珈琲 and candidates A (登山, 珈琲), B (散歩, 映画, 読書), C (ゲーム) gave B 50% > A 25% > C 0% with explanations. Only `http://tauri.localhost` files were loaded. | `app-ranking.jpg` |
| No traffic, 30 s after input | No socket for uid 10150 in `/proc/net/{tcp,tcp6,udp,udp6}` and no entry in the BPF `mAppUidStatsMap` (nine other uids had one); `dumpsys netstats` lists it only as `set=1`. No FATAL or ANR from the app process in logcat. | — |

The first attempt (11:37–11:44) reached the integrity dialog, then the host load rose to 92–112 and adb stopped responding, so that emulator was stopped. The table above is from the second run (12:00–12:04, load average about 28) on the same AVD started again with `-wipe-data`; the list, detail, disclosure and integrity screenshots are from the first run and matched in the second. The emulator was stopped after the checks.

## Known gaps

- No physical-device Store install. The app itself was checked on a moto g05 under its previous id `network.awai.deai.dev.debug` (network-awai/app-deai `awai/docs/acceptance-20261118.md`).
- The Store on the owner's moto g05 was not replaced: it is a newer Store build (versionCode 5) whose catalog includes apps this build was not given.
- The app uses Tauri's default launcher icon and the Store shows the generic apps icon.
