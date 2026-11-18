# Tabi Mikake in the bundled Store (AWAI-3302, 2026-11-18)

Source, build and disposable-emulator evidence only. Nothing here proves a physical-device run, production signing, online catalog publication, a custom ROM, a signed OTA or Native selfhost.

## Input

- APK: network-awai/app-tabi-mikake (AWAI-3301 PR #5, and PR #8 which removes `android.permission.INTERNET`), Tauri v3 arm64 debug build of commit `fa92fa7`'s app source.
- `network.itonami.tabimikake`, versionCode 1000, versionName 0.1.0, minSdk 35, targetSdk 37.
- 29,621,240 bytes, sha256 `2fb1fe61112a78f4d73db0e311c89c54a6cc2d89585e98fa2665cd0aa04adb93`.
- One signer, the local Android debug key: the same development identity as the other Store apps.
- `aapt2 dump badging` lists no `android.permission.INTERNET`.

## Source and build

- `node --test` on each `android/tests/*.test.mjs`: 24 pass. The new domain test admits a 29.6 MB `packages/tabi-mikake.apk` and refuses three other asset names.
- `bb -cp android/contracts/src:android/contracts/test -m itonami.store.domain-test`: 4 tests, 20 assertions, 0 failures.
- `python3 android/build.py --version 1 --itonami-apk store/distribution/dev-20261116/itonami.apk --tabi-mikake-apk <apk>`: passed. The signed bundled catalog lists the app with the APK's own version, size and digest.
- Negative control: the same build with `--tabi-mikake-apk store/distribution/dev-20261118/torihiki-bot.apk` stops with `tabi mikake APK package is not network.itonami.tabimikake`. The build also stops if the APK requests INTERNET or its signer is not exactly the development identity (not exercised with a real APK).
- `python3 android/build-tests.py --version 1`: passed.

## Disposable emulator

`sdk_phone64_arm64` Android 15 (`AE3A.240806.019`, userdebug, test-keys), on a fresh AVD started with `-wipe-data` on port 5892. The AVD was deleted afterwards.

| Step | Result | Evidence |
| -- | -- | -- |
| `StoreInstrumentation` | 14 assertions passed. These include `verifiedApk("network.itonami.tabimikake")`, which checks bytes, sha256, package, versionCode and signer. | — |
| Store list | Tabi Mikake is listed as v0.1.0 · 同梱アプリ. | `store-02-list.jpg` |
| Detail | 「旅の価格を、手元で比べる。」, 端末内で使える・架空データ, and the catalog description (no booking or payment, fictional data only, nothing sent). | `store-04-detail.jpg` |
| Pre-add disclosure | 送る情報: 外部への送信なし. 「予約・支払い・個人情報の入力はしません。外部への送信はなく、ネットワークの権限もありません。」 | `store-05-disclosure.jpg` |
| Store integrity dialog | Shows the sha256 above before Android's installer opens. | `store-07-integrity.jpg` |
| Android install | Android's installer asked "Do you want to install this app?" and installed it. `installerPackageName=network.awai.store`, versionCode 1000, no INTERNET permission. | — |
| Launch | `network.itonami.tabimikake/.MainActivity` resumed; the page at `https://tauri.localhost/` showed 6 offers. | `store-10-launched.jpg` |

On this test emulator, the Store's "install unknown apps" permission was granted with `appops` instead of through the Settings screen.

### App on the same build (installed directly with adb before the Store run)

- Over WebView DevTools: filtering HND-CTS 2026-12-20 shows ￥9,800 (pay unknown, stale), ￥17,980 (paid), ￥18,400 (unpaid) in that order. `app-01-compare.jpg`.
- Adding a ￥18,000 watch shows 2 hits and it is still there after a page reload. `app-02-watch.jpg`.
- Every request the page made went to `https://tauri.localhost/` (index, 3 stylesheets, app.js, the font, favicon).

## Interference from another session

A first emulator for this check (AVD `Awai_Tabi_AWAI3302`, port 5810) was taken over by another session, which installed `network.awai.yataverse` and drove it while this check ran. That run was abandoned without touching the other session's work; all results above come from the second emulator on port 5892. The 5810 emulator was left running for the other session.

## Known gaps

- No physical device was attached, so the device half of AWAI-3302's acceptance is not met.
- Operation with the itonami bot profile was not checked: the profile does not exist yet (AWAI-3299, waiting on AWAI-3303's inference decision).
- The app uses Tauri's default launcher icon and the Store shows the generic apps icon.
- App content scrolls under the status bar (no top inset).
- The host was heavily loaded (load average about 170) by other sessions' emulators; System UI showed "not responding" once and was dismissed with Wait. Launch times were not measured.
