# Store standing update approval: emulator check (AWAI-3661, 2026-11-21)

Build: `android/build.py --skip-cljs --version 9001` from this branch; `store-v9001.apk` installed on an
API 35 arm64 emulator (`system-images;android-35;default;arm64-v8a`, AVD created for this check, no
physical device). Stored value read with `run-as network.awai.store cat shared_prefs/auto-update.xml`.

| Step | Result |
| -- | -- |
| Open 更新 | card shows Off and two enable buttons (`off.png`) |
| Tap 有効にする（Wi-Fi のみ） | native dialog lists origin, operations, data, conditions, network, expiry, development key (`native-dialog.png`) |
| Press Allow after more than 600 ms | stored `v1|1|1795233164|1803009164|1|` (90 days, unmetered only); card shows Enabled (`enabled.png`) |
| Tap 自動更新を止める | stored `v1|0|0|0|1|` |
| Open dialog, press Allow after 250 ms | nothing stored (`v1|0|0|0|1|`), dialog stays open |
| Press 今はしない | nothing stored |

Not checked here: per-app exclusion on a device (no Store-installed apps on the emulator; covered by
`UpdateApprovalRecordTest`), a physical device, and any automatic update (not implemented yet).
