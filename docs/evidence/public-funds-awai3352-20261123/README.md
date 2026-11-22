# Public Funds — low-load cold-start ANR re-measurement on the API 35 VM (AWAI-3352, 2026-11-23)

Record only; do not rewrite. Tracking: [AWAI-3352](https://linear.app/kotobalabs/issue/AWAI-3352) (Backlog). This record covers **only the emulator slice** of AWAI-3352: cold-start re-measurement at low host load. Physical-device acceptance happens later after the owner names a device and is **not run here**.

Evidence is kept separate for each level: **source**, **build**, **Android VM**, **device**, **live operation**. Anything not measured is `unknown`. This is a new record; the AWAI-3297 record at `docs/evidence/public-funds-awai3296-20261118/apk-vm/` is unchanged.

## Source changes in this unit

- None. Record only. Source: branch `awai-3352-anr-remeasure` from awai-os main `bb2a01f0` (#432). `npm test` 13/13 (apps/public-funds), 14/14 (apps/securities-drafts control). The static build has 20 pinned files per app. One build-side note: the first Android build attempt failed because `rustup` was not on `PATH`; the retry put `~/.cargo/bin` on `PATH` and succeeded (see `build.txt`). The build reordered one `Cargo.lock` entry in `apps/securities-drafts/src-tauri` (ordering only); that file was reverted before commit so this PR diffs only this evidence directory.

## Build

`CARGO_BUILD_JOBS=4 nice -n 10 npx tauri android build --debug --apk --target aarch64` after `(cd packages/awai-ui && npm ci && npm run build)`, `npm ci`, `npm test`, `npm run build` (toolchain in `build.txt`: Android SDK `~/Android/sdk`, JDK 21 `/opt/homebrew/opt/openjdk@21`, NDK `27.0.12077973` at `~/Android/sdk/ndk/27.0.12077973`, Rust at `~/.cargo/bin`).

Final Public Funds APK is `app-universal-debug.apk`: sha256 `1b8a36082999176fa7e6d3200f133763c95a2d8e28158a768305b4de265fcb25`, 21,816,403 bytes (`apk-sha256.txt`). Control (Securities Drafts) APK: sha256 `b246bf08434302c8f8a6f793d8bb97f63cea35dbd19a1fd46f829e4929446062`, 21,798,452 bytes. Both are debug builds with test signing, not releases.

`aapt2 dump permissions` (`permissions.txt`): the only permission is `network.itonami.publicfunds.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (AndroidX). There is no `INTERNET`. On the device, `dumpsys package` (raw `dumpsys-publicfunds.txt`) grants only that same permission.

## Android VM

The device was this session's own emulator, not shared with any other session: AVD `Awai_PublicFunds_AWAI3352`, API 35 `system-images;android-35;google_apis;arm64-v8a` (fingerprint `google/sdk_gphone64_arm64/emu64a:15/AE3A.240806.043/12960925:userdebug/dev-keys`, the current name for the prior run's `sdk_phone64_arm64` userdebug class; that image was not present on this host and was installed with `sdkmanager`), `pixel_6` device profile, 2 cores, 3072 RAM, data wiped at boot (`-wipe-data -no-snapshot -no-snapshot-save -no-window -no-audio -gpu swiftshader_indirect -no-boot-anim`, port 5556), WebView `124.0.6367.219` (same as AWAI-3297), app UID 10207. The emulator ran 06:09–06:15 JST (21:09–21:15Z) and was stopped with `adb -s emulator-5556 emu kill` right after the control runs. `adb devices -l` showed exactly this one emulator during all measurements; everything was addressed with `adb -s emulator-5556`. A foreign emulator (`awai-emu`, `emulator-5554`, other session) was running at session start and exited on its own before the measurement window; it was never addressed. `10.77.0.2:5555` was never addressed. No physical device was touched.

### Low-load rule

Heavy builds ran first. Measurements kept only when the host 1-minute load average was **< 8.0** before the run; all kept runs start at 5.81–7.31 (1-min), with end-of-run values up to 7.31 recorded per run in `raw/uptime-run*.txt`. The prior run's host load was 140–310. Other sessions were active on this host during the window (e.g. a shadow-cljs build at session start); load never approached prior levels. Exact `uptime` output is in `raw/`.

### Cold starts — Public Funds

Each run: `logcat -c`, `am force-stop network.itonami.publicfunds`, `am start -W -n network.itonami.publicfunds/.MainActivity`. Raw `am start -W` output, `uptime` lines, and full `logcat -d` are in `raw/` (`amstart-run*.txt`, `uptime-run*.txt`, `logcat-run*.txt`).

| Run | Host 1-min load at start | `am start -W` TotalTime | ANR? |
|---|---|---|---|
| 1 | 6.55 | 819 ms | No |
| 2 | 6.88 | 768 ms | No |
| 3 | 6.29 | 558 ms | No |
| 4 | 6.41 | 874 ms | No |
| 5 | 5.81 | 497 ms | No |

ANR search across all five logcats (`am_anr`, `Input dispatching`, `is not responding`, `Waited … for`, `FocusEvent`) returned **no matches**. No system-app ANR observed in the same windows either (no `calendar`/`systemui`/`keyguard` ANR lines in any run logcat; grep returned nothing). WebView sandboxed-renderer `Start proc` lines: run 1 +1.23 s after app `Start proc` (06:12:17.767 → 06:12:18.999, 0.49 s after `Displayed`); run 2 +0.59 s; run 3 +0.68 s; run 4 +0.69 s; run 5 +0.61 s. Every run set `LaunchState: COLD` and completed; `Displayed` times are the `TotalTime` values above. A running-app screenshot after the runs is in `raw/f01-publicfunds-running.png`.

### Control — Securities Drafts

Same procedure (`network.itonami.securitiesdrafts/.MainActivity`), same emulator, same load window, 4 cold starts (`raw/control-securities/`):

| Run | Host 1-min load at start | TotalTime | ANR? |
|---|---|---|---|
| 1 | 4.70 | 657 ms | No |
| 2 | 4.11 | 438 ms | No |
| 3 | 5.06 | 394 ms | No |
| 4 | 5.87 | 574 ms | No |

No ANR in any control run (`grep` for the same patterns returned only `Start proc`/`Displayed` lines). Both Tauri apps therefore measure in the same band at low load (Public Funds 497–874 ms, Securities Drafts 394–657 ms), consistent with the prior Securities Drafts record's 1,145 ms cold start at lower load.

### Comparison vs AWAI-3297

| | AWAI-3297 (2026-11-18) | AWAI-3352 (this record, 2026-11-23) |
|---|---|---|
| Host 1-min load | 140–310 | kept runs 5.81–7.31 (< 8.0 rule) |
| Cold starts | 3 (2nd build + final APK) | 5 (final APK) + 4 control |
| Times | 15,690 / 17,088 / 9,835 ms | Public Funds 497–874 ms; Securities Drafts 394–657 ms |
| ANR count | 2 of 3 | 0 of 5 (0 of 4 control) |
| ANR text/timing | `Input dispatching timed out … Waited 5003ms/5110ms for FocusEvent`; ~0.4 s after WebView sandboxed renderer `Start proc`, 12–31 s after app `Start proc`; Calendar/device-lock controller ANRs, SystemUI "isn't responding" in the same session | none — no matching lines in any logcat |
| Emulator | AVD `Awai_PublicFunds_AWAI3297`, API 35 userdebug, -port 5560 | AVD `Awai_PublicFunds_AWAI3352`, API 35 userdebug (`sdk_gphone64_arm64`), -port 5556 |
| WebView | 124.0.6367.219 | 124.0.6367.219 |

Effect size: at low host load the same app on the same WebView version starts ~12–30× faster than under the prior overload and without ANR. The control app behaves the same way.

### Cause verdict

**Supported: consistent with host load starving WebView start-up.** The data support this reading: ANRs and 10–17 s starts occurred only under extreme host overload (140–310, also ANRing system apps); at 1-min load < 8 both Tauri apps cold-start well under 1 s with no ANR. The verdict is limited to this host/VM and its load conditions: it does not identify a mechanism inside the app, and it says nothing about physical-device behaviour. Startup runs were steady-state after boot on a single emulator (not a controlled A/B re-running the prior overload), so "consistent with" — not "proven to be" — is the correct strength.

## Device (Awai OS on hardware)

**Not run, unknown.** No Awai OS device was identified for this task and no physical device was used or addressed. Physical-device acceptance awaits the owner naming a device (AWAI-3352 dependency).

## Live operation

**None.** The app is not in the Store catalog and is not distributed. No Store upload or deployment was performed.

## Not covered

- Physical-device install/launch/display and bot-result import (awaits owner-named device; AWAI-3352).
- Release signing, OTA, custom ROM, persistent install across reboot, encrypted backup and restore.
- The Android file picker, TalkBack, tablet width, dark theme on the device.
- Reproducing the prior overload (140–310 load) to A/B the ANR threshold — not attempted; the low-load leg only was in scope.
- Fetching from a publisher (ADR 0046 O1) and publication (O2).
