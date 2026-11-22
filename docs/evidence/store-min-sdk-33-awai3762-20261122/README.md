# Store, Home, Yotei, Torihiki: minSdkVersion 35 → 33 on an API 33 emulator (AWAI-3762)

Date: 2026-11-22. Owner default 2026-11-22 (recorded on AWAI-3729): minSdkVersion 33.

Emulator: AOSP `system-images;android-33;default;arm64-v8a` (`sdk_phone64_arm64:13/TE1A.220922.034/10940250`), AVD `Awai_Store_AWAI3653_API33`, port 5602. System WebView 101.0.4951.61 (not updated; no Play).

Source: main `dc7aa29c` plus this change. `python3 android/min-sdk-floor.py --kind {store,home,yotei,torihiki} --max 33` exit 0 for all four; `--max 32` exit 1 for the Store (negative control). Store floor 33, 13 source files.

Builds (debug identity, local only): `python3 android/build.py --version 1|2 --skip-cljs`, `python3 android/build-tests.py --version 1`. store-v1 SHA-256 `bbbb437d…`, store-v2 `55af2650…`.

| Check | Result |
|---|---|
| Install a minSdk 35 Store (built from the previous main) | `INSTALL_FAILED_OLDER_SDK: Requires newer sdk version #35 (current version is #33)` (negative control) |
| Install store, yotei, torihiki, home v1 | Success; `minSdk=33 targetSdk=37` |
| `am instrument -w network.awai.tests/.StoreInstrumentation` | `Awai Android store integrity: 86 assertions passed` |
| Store first screen | renders (`api33-store.png`) |
| Launch Yotei, Torihiki, Home | each becomes the top resumed activity; Yotei renders (`api33-yotei.png`); no `FATAL EXCEPTION` |
| Yotei added through the Store UI (Store's own session, Android install prompt) | `installerPackageName=network.awai.store` |
| Store v2 installed over v1, auto-update allowed in the native dialog (all networks), `AutoUpdateInstrumentation -e package network.itonami.yotei` | `committed session`, Yotei versionCode 1 → 2 with no prompt, log `installed` |
| Same, but Yotei put in place with `adb install -i network.awai.store` | Android asked for confirmation; Store abandoned the session, logged `needs-approval / android-asked`, and notified. The shell-set installer is not accepted as the installer of record for an update without user action on API 33. Not a Store defect; recorded so this shortcut is not used as evidence |

Not checked here: an API 33 or 34 physical device, a newer WebView on API 33, background job timing on API 33, POST_NOTIFICATIONS prompt behavior.
