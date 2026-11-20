# Horei — final APK re-check (AWAI-3134, 2026-11-18)

Record only; do not rewrite. This completes the re-run left open in
`../horei-awai3134-20261118/final-STATUS.txt`.

Emulator `Awai_Horei_AWAI3134` (`build.txt`: API 35 `sdk_phone64_arm64`
userdebug), WebView `124.0.6367.219` (`webview-version.txt`). The installed APK was
pulled from the device and hashed: `84df5e653fa1a3a496868bb3c4c6e989cf9f7c68149c7f6f8d631809cb81c47e`,
the final debug APK built from the merged source (PR #210). App UID 10148.

## 1. Network on, no input: per-UID traffic

App data cleared (`pm clear`), airplane mode off, default network up (ping to
8.8.8.8 answered). Cold start at device epoch `launch-epoch.txt` (1794940165,
`launch.txt`: COLD, 1143 ms), then 80 s idle with no input.

| Check | Result | File |
|---|---|---|
| Kernel per-UID counters (`mAppUidStatsMap`) after the window | No row for the app (10148), its WebView renderer (`u0_i9000`, 99000) or the WebView service (10109). Other UIDs show growth in the same window (e.g. 1020: 36,555 → 105,334 rx bytes), so the counters were live | `netstats-appuidstats-before.txt`, `netstats-appuidstats-after.txt` |
| `/proc/net/{tcp,tcp6,udp,udp6}` poll, 1 s × 75, UID 10148 or ≥ 90000 | 0 lines | `poll.sh`, `sockets-poll.txt` |
| Screen | Launched, `Awai Shell / Tauri v3 · 9,536件` | `f01-launch-online.png` |

Horei did not reproduce the Google IPv6 TLS connection seen with Deai. The
likely reason is that Horei's manifest has no `INTERNET` permission, so neither
the app UID nor its WebView renderer can open an inet socket. This is
an inference; Deai was not run here for comparison. The `/proc/net` poll is
supporting evidence only; from `adb shell` it showed few sockets for any UID.
The kernel counters are the primary evidence.

## 2. Airplane mode on: fixes and Japanese UI

Per-app locale `ja-JP`, airplane mode on (`Active default network: none`, Wi-Fi disabled).

| Check | Result | File |
|---|---|---|
| Search `333AC0000000017` | `1件`, 婦人補導院法, chips 法律 / 廃止 / 刑事 | `f03-results.png` |
| Disclosure marker | `▶ 全文の所在` visible; opens to SHA-256 and `27,749 バイト` | `f05-disclosure-open.png` |
| Amendment trace | 3 levels ending in `改正法令の記録なし`; status `3件の改正関係をたどりました。` | `f06-trace.png` |
| English singular (locale `en-US`) | `1 result` | `f07-en-one-result.png` |
| Launcher icon | Scales icon labelled 法令, not the Yotei calendar | `f08-launcher.png` |
| Page requests | All `http://tauri.localhost/…`; no `favicon.ico` | `webview-resources.json` |

### Not fixed / found

- **The icon is still requested repeatedly.** The `favicon.ico` 404 is gone, but
  `icon.png` was requested 18 times in one session. That is about once per
  `history.replaceState` while typing the search, plus each navigation. All
  requests are to the in-APK asset handler and there is no network effect.
  It is still the same repetition the first run reported, not removed.
- No spacing between `27,749 バイト` and the next section heading.
- The launcher icon's foreground reaches the adaptive-icon mask edge; it is not inset to the safe zone.

## Not covered

Release signing, store install (AWAI-3138), physical devices, reboot
persistence, TalkBack, Figma review, tablet width on Android.

The emulator was stopped right after the run (`emu kill`, 2026-11-17T18:32:40Z).
