# Public Funds — debug APK on the API 35 VM, with the bot's output (AWAI-3297, 2026-11-18)

Record only; do not rewrite. Tracking: [AWAI-3297](https://linear.app/kotobalabs/issue/AWAI-3297), parent [AWAI-3291](https://linear.app/kotobalabs/issue/AWAI-3291). Source: branch `jun784/awai-3297-public-funds-apk` from awai-os main `bc5a11a` (#236).

Evidence is kept separate for each level: **source**, **build**, **Android VM**, **device**, **live operation**. Anything not measured is `unknown`.

## Source changes in this unit

- `src-tauri/gen/android`: generated with `tauri android init`, then given the same settings as `apps/securities-drafts`: no `INTERNET` permission, `allowBackup="false"`, `org.gradle.vfs.watch=false`, `org.gradle.daemon=false`, NDK pinned, and the adaptive launcher icon.
- Two layout fixes found on the device:
  - The bottom navigation stays at the bottom of the screen when the content is short, as in Figma `307:298`.
  - The flow chart uses short COFOG names (`short.*` keys in ja and en), so long English names such as "General public services" are no longer cut off at the right edge. The full names stay in the table and in the list of small divisions.
- `npm test`: 13/13. The static build has 20 pinned files.

## Build

`CARGO_BUILD_JOBS=4 nice -n 10 npx tauri android build --debug --apk --target aarch64` (JDK 21 Temurin, NDK 27.0.12077973, host load average 140–310). The final APK is `app-universal-debug.apk`: sha256 `4ba47e5f69db5037c0dcaf4701dc86563f3d0275529c857ace6be9a9fb3950f5`, 36,407,131 bytes (`apk-sha256.txt`). It is a debug build with test signing, not a release.

`aapt2 dump permissions` (`permissions.txt`): the only permission is `network.itonami.publicfunds.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (AndroidX). There is no `INTERNET`. On the device, `dumpsys package` grants only that same permission.

## Android VM

The device was this session's own emulator (`build.txt`), not shared with any other session: AVD `Awai_PublicFunds_AWAI3297`, API 35 `sdk_phone64_arm64` userdebug, data wiped at start, WebView `124.0.6367.219`, app UID 10148. Seven emulators belonging to other sessions and one remote device were running on the same host; this session touched none of them. The emulator ran 01:21–01:46Z and was stopped right after the run.

### Network

The network was on. I took a snapshot of `mAppUidStatsMap` (`netstats-before.txt`), cold-started the app, and took another snapshot 60 s later with the app idle (`netstats-after-60s.txt`). This was with the second build (`88e097cc…`), which differs from the final APK only in CSS and labels. One more snapshot was taken at the end of the session, after the final APK had been installed and used (`netstats-end.txt`).

| UID | Result |
|---|---|
| App 10148 | No row in any snapshot: 0 bytes |
| WebView renderer (isolated, 99xxx) | No row in any snapshot |
| WebView service 10112 (`com.android.webview`) | +19,716 rx / +6,404 tx in the 60 s window. This matches the WebView's first-run fetch recorded for Payment Drafts and Securities Drafts; it comes from the system WebView, not from the app's UID |
| 1020, 1051, 1000, 0 | Small system traffic in the same window |

### The bot's output, end to end

The input was the actual output of the `awai-public-funds` profile: `jp-fy2024-general.result.edn`, written to `workspace/drafts/` by `itonami-agent-kbb cron run d4e8b2c61f05 -p awai-public-funds` (AWAI-3294). sha256 `26eea107…bc5a02b`, the same file as the app's test fixture. It was pushed to `/sdcard/Download/`, where the on-device sha256 was identical, and put into the import field over the WebView DevTools socket. The Android file picker itself was not exercised.

| Check | Result | File |
|---|---|---|
| The bot's refusal (`rank-ministries-refused.refusal.edn`) | "Could not import / This is a refusal written by the bot, not a result. / Saved results were not changed." | — |
| The bot's result, Check and import | "Imported."; the list shows jp-fy2024-general · FY2024 · 66 rows · 2 sources. The first attempt returned the refusal text: on the slow device, the re-render from the previous step put the refusal text back into the field after the result had been entered. Pressing Check again and then Check and import succeeded | — |
| Flow (en-US) | Eight ministries plus Other ministries flowing to 01, 02, 04, 09, 10 and Unmapped; the small divisions 03, 06, 07 and 08 are listed below the chart; Unmapped ¥8.00 tn | `f01-flow.png` |
| Budget and outturn (en-US) | ¥112.57 / ¥126.51 / ¥123.02 / ¥14.55 tn; both checks "6,962 rows match"; 18 ministries | `f02-budget.png` |
| Sources (en-US) | Both MOF sources, "sha256 checked", fetch date | `f03-sources.png` |
| A saved result's import time changed to an invalid value, then reload | Read-only card and status line; the file picker and Check and import are disabled; the saved data was not rewritten (its length differs only by the edit). Restoring it brings the result back | `f04-read-only.png` |
| Japanese (`cmd locale set-app-locales … ja-JP`) | `navigator.languages` = ja-JP, en-US; the same figures in 兆円 | `f05-budget-ja.png` |

### Start-up and ANR

| Cold start | `am start -W` | ANR |
|---|---|---|
| 1 (second build, data cleared) | ok, 15,690 ms | Yes, 10:32:21: "Input dispatching timed out … Waited 5003ms for FocusEvent" |
| 2 (after force-stop) | ok, 17,088 ms | No |
| 3 (final APK, after install) | ok, 9,835 ms | Yes, 10:42:12, same reason |

Both ANRs fired about 0.4 s after the WebView's sandboxed renderer process started, 12–31 s after the app process started (`anr-app.txt`, `f00-anr.png`). When the app's main thread was dumped afterwards, it was idle in `Looper.pollOnce`. During the same session, Calendar and the device lock controller also hit ANRs at boot, and SystemUI showed "isn't responding". Host load average was 140–310.

Cause: **unknown**. It is consistent with WebView start-up being starved on an overloaded host, but there was no control run at low load or with another Tauri app, so it cannot be ruled out that the app adds to it. Securities Drafts' record shows a 1,145 ms cold start at lower load. The ANR dialogs did not respond to injected taps; they were closed with `CLOSE_SYSTEM_DIALOGS`.

## Device (Awai OS on hardware)

**Not run, unknown.** No device running Awai OS was identified for this task. The remote device connected to this host (`10.77.0.2:5555`, a LineageOS-based x86_64 build) has an unknown owner and purpose, so I did not use it.

## Live operation

**None.** The app is not in the Store catalog and is not distributed. The bot profile is not installed on any host or in the root agent registry (JUN-302).

## Not covered

- Release signing, OTA, custom ROM, persistent install across reboot, encrypted backup and restore.
- The Android file picker, TalkBack, tablet width, dark theme on the device.
- A start-up measurement at low host load (open: the ANR cause above).
- Fetching from a publisher (ADR 0046 O1) and publication (O2).
