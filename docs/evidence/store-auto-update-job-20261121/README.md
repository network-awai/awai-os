# Store daily automatic-update check: emulator run (AWAI-3668, 2026-11-21)

Builds:
- Online Store: `android/build.py --skip-cljs --version 3 --online-pins android/online-pins.dev.json`.
- Yotei v1: `--version 1`.

Emulator: API 35 arm64, created for this check, with real network access to raw.githubusercontent.com. No physical device.

Setup: Yotei 1 installed with the Store as installer of record; the Store allowed to install apps (app-op).

| Step | Result |
| -- | -- |
| Before the approval | no job 3668 scheduled |
| 「自動更新を有効にする（Wi-Fi のみ）」 → native dialog → Allow | stored `v1|1|…|1|`; Android asked for notification permission (allowed); job 3668 scheduled (`AutoUpdateJob`, unmetered) |
| Job ran on its own right after scheduling, then `cmd jobscheduler run -f` | pointer sequence 1 verified → catalog r107 fetched, pinned bytes matched, signature verified, admitted → Yotei 2001 APK (36,155,042 bytes) fetched, matched its pin, staged → `AutoInstall` **refused `new-permission`**; Yotei stays 1 |
| Second run | reused the staged APK (download counted once: `download-bytes` 36155042) |
| Notification | 「更新の確認が必要です」 / 「1 件の更新は自動では入れられません。…」 |
| 更新 tab (`card.png`, `log.png`) | 「Yotei: 自動更新（前回: 新しい権限を求めている）」, 「1 日 1 回、条件を満たす回線のときに確認します。」, the log with each check |
| 「自動更新を止める」 | stored `v1|0|0|0|1|`; job 3668 cancelled |
| Existing `StoreInstrumentation` (after `pm clear`) | 85 assertions passed (`instrumentation.log`) |

The refusal is correct. The published Yotei 0.2.1 (Tauri) requests
`network.itonami.yotei.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, which the locally built Yotei 1 does
not hold, so the update waits for the person. The silent install itself was shown in step 4
(`docs/evidence/store-silent-update-20261121/`).

Notes:
- The existing `StoreInstrumentation` expects Itonami versionCode 1000. It fails with
  `itonami version` once the online r107 catalog (1002) has been admitted. This happened here
  before `pm clear`, and it is the same after a manual online check. That assumption is in the
  existing test.
- A periodic job runs once soon after it is scheduled. `force-stop` clears jobs and the next Store
  launch re-schedules them, so each relaunch after a force-stop causes one check.
- The Yotei presentation text 「新たな権限の追加はありません」 contradicts this real update, which does
  ask for a new permission. That text is hard-coded in `client.js`.
- Not checked: a physical device (moto g05), reboot persistence, and a real eligible online update.
