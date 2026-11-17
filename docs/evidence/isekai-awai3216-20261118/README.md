# Isekai Fork — debug APK on the API 35 VM (AWAI-3216, 2026-11-18)

Record only; do not rewrite.

Emulator `Awai_Isekai_AWAI3216`, created for this run from the Horei AVD
configuration (`build.txt`: API 35 `sdk_phone64_arm64` userdebug, 3 GiB RAM,
2 cores, `-wipe-data -no-snapshot`). WebView `124.0.6367.219`
(`webview-version.txt`). Debug APK built from this branch with
`npx tauri android build --debug --apk --target aarch64` (JDK 21, NDK
27.0.12077973). APK sha256 `6a5c3dfa19f1e804aae9505380d0eb5431ae7b24387bc5e53cb81f16f747fe72`
(21,761,021 bytes). The copy installed on the device was pulled back and has the same hash.
App UID 10148.

## Permissions

`aapt2 dump permissions` and `permissions.txt`: the only permission is
`network.itonami.isekai.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (AndroidX), as
with Horei. No `INTERNET`.

## Launch and UI

| Check | Result | File |
|---|---|---|
| Cold start | `Status: ok`, `LaunchState: COLD`, 826 ms | `launch.txt` |
| Launch screen (en-US) | `Awai Shell / Tauri v3 · saved on this device · never published` | `f01-launch.png` |
| Draft a fork (adb text input) | Commit preview with game, parent CID, did:key and message; `Draft saved.` | `f02-saved.png` |
| External operations | 3 planned operations, each `Disabled` | `f04-operations.png` |
| Per-app locale `ja-JP` after `am force-stop` | Japanese UI | `f05-ja.png` |
| Drafts list after the force-stop | `1件`, the saved draft, `未公開` | `f03-drafts.png` |

## Network: per-UID traffic

Network on (ping to 8.8.8.8 answered). The first counter snapshot was taken just
before the cold start (`launch-epoch.txt`); the second after 60 s of idle; the
third at the end of the UI session (about 4 minutes after launch).

| UID | Result |
|---|---|
| App 10148 | No row in `mAppUidStatsMap` in any snapshot |
| WebView renderer 99000 (`u0_i9000`) | No row in any snapshot |
| WebView service 10109 (`com.android.webview`) | **No row before launch; 58,663 rx / 7,955 tx bytes after; unchanged at the end** |

Other UIDs (e.g. 1020) grew in the same window, so the counters were live.

### Found: WebView variations seed on first launch

The 10109 traffic is the system WebView, not the app. On this freshly wiped
device the app's WebView found no variations seed and asked the WebView service
for one; the service then requested a network as its own UID
(`logcat-webview-variations.txt`: `Requesting new seed from IVariationsSeedServer`,
`Start proc … com.android.webview:webview_service/u0a109 for service …VariationsSeedServer`,
`requestNetwork … asUid: 10109`). It happened once and did not repeat during the
session. The app's manifest has no `INTERNET`, so the app itself could not open a
socket; the fetch was triggered by its first WebView use. Horei's
re-check (`../horei-awai3134-final-20261118/`) ran on an AVD that had already
been used and did not show it; that is likely why, but it was not compared here.

## Not covered

Release signing, Itonami Store distribution, physical devices, reboot
persistence, TalkBack, Figma review, tablet width, the paired bot profile
running against this app, any publication, payment or gem mint.

The emulator was stopped right after the run (`emu kill`, 2026-11-17T18:54:35Z).
