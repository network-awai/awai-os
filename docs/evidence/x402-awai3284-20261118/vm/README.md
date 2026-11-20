# x402 Pay — API 35 VM re-check of the AWAI-3284 fixes (2026-11-18)

Record only; do not rewrite.

## Build

`nice -n 10` and `CARGO_BUILD_JOBS=4`, `npx tauri android build --debug --apk --target aarch64` in `apps/x402` at main c0f1df7 (includes #218). JDK 21 Temurin, NDK 27.0.12077973, Tauri CLI 3.0.0-alpha.6. 1 min 33 s. `app-universal-debug.apk`, 21,729,507 bytes, sha256 `e1223be0e2e662fa5f3be87c6a859dfcf6d6cb0399c09cb1b8b944d380d4980b`.

## Device

One emulator, `Awai_X402_AWAI3284` (API 35, `default/arm64-v8a`, config copied from `Awai_Isekai_AWAI3216`, `-wipe-data`), port 5672, about 3 minutes (boot 23:47Z, killed 23:50:38Z). Host load 27 when it started; one other session's emulator (5600) ran at the same time. Device locale en-US. `device.txt`.

## Results

| Check | Result | File |
|---|---|---|
| Launch | Cold start 1.10 s, `Awai Shell / Tauri v3`, English UI, light bars with dark icons | `01-light-launch.png` |
| Live switch to dark (`cmd uimode night yes`) | Same activity (no relaunch); background `#14110f`, white status-bar and navigation icons | `02-dark-live-switch.png` |
| Live switch back to light | Same activity; white background, dark icons | `03-light-live-switch.png` |
| Traffic | App UID 10148 has no entry in the BPF `mAppUidStatsMap` 74 s after launch (23:48:09Z → 23:49:23Z) nor at the end of the run: 0 bytes. The APK declares no `INTERNET` permission. | `uid-traffic-74s.txt`, `uid-traffic-end.txt` |
| Read-only | 51 drafts written to the app's `localStorage` over WebView DevTools, then force-stop and relaunch: the read-only notice shows at start, Save is disabled, the notice stays on Drafts and Operations, the stored value is byte-identical afterwards | `04-readonly-start.png`, `05-readonly-drafts.png` |
| Locale switch (`cmd locale set-app-locales … ja-JP`) | The activity relaunched (same process, `relaunch` in WindowManager) and the page reloaded: `lang=ja`, navigator.languages `[ja-JP, en-US]`, the read-only notice in Japanese. Back to `en-US`: English again | `06-locale-ja.png` |
| Crashes | No `FATAL` in logcat | `logcat-x402.txt` |

## Observed, not fixed here

In the read-only state the Drafts view also says "No drafts yet." above the notice. The stored drafts exist but cannot be shown, so that line is misleading. Isekai shares the same code path.
