# Store: permission note on the update screen comes from the real diff (AWAI-3653)

Date: 2026-11-22. Emulator: AOSP API 35 (`system-images;android-35;default;arm64-v8a`, AVD `Awai_Store_AWAI3653_API35`, port 5600), WebView 124.0.6367.219.

## What changed

- `UpdatePolicy.addedPermissions(installed, candidate)`: sorted list of the Android permissions the candidate requests and the installed version does not. Condition 4 (`new-permission`) uses the same function.
- `HostActivity.Bridge.permissionChanges(id)`: verifies the catalog APK (size, SHA-256, package, version, signer, as for install), reads its requested permissions and returns `{known, versionCode, added}`. Unknown (online APK not yet fetched, app not installed, any failure) returns `known:false`.
- `client.js`: the Yotei `updateNote` no longer says 「新たな権限の追加はありません」. The update screen adds a separate line from `permissionChanges`: none, the added permissions by name, or "shown after the update file is checked" when unknown.

The hard-coded Itonami `versionCode==1000` check in `StoreInstrumentation` had already been removed on main by bda41fb3 (AWAI-3705); `verifiedApk` compares the APK with the catalog's own `versionCode`.

## Runs

Builds: `python3 android/build.py --version N --skip-cljs` (debug identity, local only).

1. Install Yotei v1 (`yotei-v1.apk`), then Store v2 (bundles Yotei v2, same permissions). Updates tab: 「この更新で新たに求める権限はありません。」 — `step1-updates-api35.png`.
2. Negative control: a temporary local patch to `build.py` (reverted, not committed) made Yotei request `android.permission.INTERNET`; built Store v3 and installed it over v2, Yotei v1 still installed. Updates tab: 「この更新で新たに求める権限: インターネット接続（android.permission.INTERNET）」 — `step1-updates-negative-api35.png`.

Page text was read through WebView DevTools; the tab was opened with a real tap (the Store ignores untrusted clicks).

APK SHA-256 (local, not published): store-v2 `b8e37173…305e`, yotei-v1 `c9a269d8…312f`, store-v3 (negative control) `3997589f…4e9c`.

## Tests

- `bash android/tests/update-policy.sh`: UpdatePolicy 37 checks, UpdateApprovalRecord 26 checks, 0 failures.
- `node --test android/tests/*.test.mjs`: 37 tests, 37 pass.
