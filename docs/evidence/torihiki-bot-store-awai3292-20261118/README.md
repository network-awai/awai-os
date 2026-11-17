# Torihiki Bot in the bundled Store (AWAI-3292, 2026-11-18)

Source, build and disposable-emulator evidence only. Nothing here proves production signing, online catalog publication, a physical-device run or a bot launch.

## Input

- APK: network-awai/app-itonami-torihiki `app/` (AWAI-3258, PR #7), Tauri v3 arm64 debug build.
- `network.itonami.torihiki.bot`, versionCode 1000, versionName 0.1.0, minSdk 35, targetSdk 37.
- 29,506,324 bytes, sha256 `797013c7abbd395eb09a75551838018a90211864b7012d0d7ccba1326556f99c`.
- One signer, sha256 `2507930b6c21b3c1cd0655527227dba75772096eff85e887bfcce2fb25b49b29`: the local Android debug key, the same development identity as the other Store apps.

## Source and build

- `node --test` on each `android/tests/*.test.mjs`: 21 pass. The new domain test admits a 29.5 MB `packages/torihiki-bot.apk` and refuses three other asset names.
- `bb … itonami.store.domain-test`: 4 tests, 20 assertions, 0 failures.
- `python3 android/build.py --version 1 --itonami-apk store/distribution/dev-20261116/itonami.apk --torihiki-bot-apk <apk>`: passed. The signed bundled catalog lists the bot with the APK's own version and digest. The build stops if the package name is different or if the signer is not exactly the development identity. The first run failed because the signer check miscounted the lines that apksigner prints; it was fixed before this pass.
- `python3 android/build-tests.py --version 1`: passed.

## Disposable emulator

The emulator was `sdk_phone64_arm64` Android 15 (`AE3A.240806.019`, userdebug), on a fresh AVD started with `-wipe-data` on port 5806. The AVD was deleted afterwards, and other sessions' emulators were not touched.

| Step | Result | Evidence |
| -- | -- | -- |
| `StoreInstrumentation` | 14 assertions passed. These include `verifiedApk("network.itonami.torihiki.bot")`, which checks bytes, sha256, package, versionCode and signer. | — |
| Store list | Torihiki Bot is listed as v0.1.0 · 同梱アプリ. | `store-02-list.jpg` |
| Detail and pre-add disclosure | Read-only, devnet only; reads bots.itonami.cloud and the devnet node, confirmed each time. No orders, signing, funds or bot launch. | — |
| Store integrity dialog | Shows the sha256 above before Android's installer opens. | `store-07-install-prompt.jpg` |
| Android install | Installed. `installerPackageName=network.awai.store`, versionCode 1000. | — |
| Launch | `network.itonami.torihiki.bot/.MainActivity` resumed and showed the bot profile card. | `store-10-bot-launched.jpg` |

On this test emulator, the Store's "install unknown apps" permission was granted with `appops` instead of through the Settings screen.

## Known gaps

- Android's installer shows the app's own label "Torihiki" and Rodo's launcher icon, so it is hard to tell apart from the Torihiki devnet app. The Store shows it as "Torihiki Bot". Renaming the label and replacing the icon belong in app-itonami-torihiki.
- No physical device, online catalog (`store/distribution`) entry, production signing or bot launch.
