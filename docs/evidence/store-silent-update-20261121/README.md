# Store automatic update without a prompt: emulator check (AWAI-3663, 2026-11-21)

Builds: `android/build.py --skip-cljs --version 1` and `--version 2` from this branch, plus
`android/build-tests.py --version 1`. Emulator: API 35 arm64 (`system-images;android-35;default;arm64-v8a`),
an AVD created for this check. No physical device.

Setup: Store v1 installed; Yotei v1 and Torihiki v1 installed with `adb install -i network.awai.store`,
so the Store is the installer of record. One attempt = `am instrument -w -e package <id>
network.awai.tests/.AutoUpdateInstrumentation`, which calls `AutoInstall.attempt` in the Store's process.

| Step | Result |
| -- | -- |
| Store v1, approval off, Yotei 1 | refused `[approval-off, not-newer, network-metered]` |
| Store v2 (bundles Yotei 2), approval off | refused `[approval-off, network-metered]`; Yotei stays 1 |
| Turn on 「すべての回線で有効にする」 in the native dialog (`approval-dialog.png`) | stored `v1|1|…|0|` |
| Attempt, Store not yet allowed to install apps (app-op default) | session committed; Android required user action, so the Store abandoned it and recorded 「更新には確認が必要です」; Yotei stays 1; no screen opened |
| Allow installs from the Store (`appops set … REQUEST_INSTALL_PACKAGES allow`, the toggle a person sets on their first Store install) and attempt | **committed; Yotei versionCode 2, installer `network.awai.store`, launcher stayed in front (no prompt)**; `installed-ops-network.itonami.yotei` recorded |
| Attempt again | refused `[not-newer]` |
| Torihiki 1 → 2 (INTERNET, catalog declares no operations) | refused `[operations-unknown]`; Torihiki stays 1 |
| 「自動更新を止める」 in the UI, then attempt | stored `v1|0|0|0|1|`; refused `[approval-off, operations-unknown, network-metered]` |

Notes:
- The first press on Allow did not register; a second press did. It was probably inside the 600 ms
  arming window after a slow dialog. Not investigated further.
- The offline Store build has no `ACCESS_NETWORK_STATE`; the network is then treated as metered
  (fail closed), which is why this run used 「すべての回線」.
- The per-app list shows Torihiki as 「自動更新」 although its updates are refused until the catalog
  declares its operations. The log and notification in step 5 should show that reason.
- Not checked: a physical device, the online catalog path, background scheduling (step 5).
