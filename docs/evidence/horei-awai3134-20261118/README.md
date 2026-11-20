# Horei — emulator evidence (AWAI-3134, 2026-11-18)

Record only; do not rewrite.

## Run 1 — debug APK `9684dff5…e4e0a`

Android emulator `Awai_Horei_AWAI3134` (API 35, `default/arm64-v8a`, created for this task), airplane mode on (`run1-airplane.txt`: `airplane_mode_on=1`, `Active default network: none`). Device locale en-US, so the UI is English.

| Step | Result | File |
|---|---|---|
| Launch | Cold start 1.9 s, host reported as `Awai Shell / Tauri v3`, 9,536 laws | `run1-01-launch.png` |
| Search `333AC0000000017` | 1 result: 婦人補導院法 | `run1-02-search.png` |
| Detail | Number, type, status, dates, ID, source; full text shown as not on device | `run1-04-detail-scrolled.png` |
| Trace amendment history | 3 levels: 困難な問題を抱える女性への支援に関する法律 → 刑法等の一部を改正する法律の施行に伴う関係法律の整理等に関する法律 → "No record of the amending law" (upstream ID `000000000000000`) | `run1-05-trace.png` |
| Requests made by the page | Every resource is `http://tauri.localhost/…` (Tauri's in-APK asset handler); no other host | `run1-webview-resources.json` |
| Sockets / traffic | App UID 10148 owns 0 tcp/tcp6/udp/udp6 sockets; no `mAppUidStatsMap` row | `run1-sockets.txt` |
| Permissions | No `INTERNET`; only the AndroidX `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | `run1-apk-permissions.txt` |

Found and fixed after this run: "1 results" pluralisation, a repeated `favicon.ico` request on every navigation, the disclosure marker hidden by `display:flex`, and the launcher icon copied from Yotei.

## Final APK `84df5e65…c47e`

Built with those fixes, installed on the same emulator with airplane mode on and per-app locale `ja-JP`. **The re-run did not complete**: the emulator's display stalled (black screencap, uiautomator "null root node") under host memory pressure, after a QEMU hang on the first boot. See `final-STATUS.txt`. The Japanese UI and the fixes were checked in a browser against the same `dist/`, not on Android.

## Not covered

Release signing, Awai OS store install (AWAI-3138), physical devices, reboot persistence, TalkBack, Figma review.
