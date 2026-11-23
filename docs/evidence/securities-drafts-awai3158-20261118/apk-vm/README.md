# Securities Drafts — debug APK on the API 35 VM (AWAI-3285, 2026-11-18)

Record only; do not rewrite.

**Build.** The debug APK was built from awai-os main `671edcb` with
`CARGO_BUILD_JOBS=4 nice -n 10 npx tauri android build --debug --apk --target aarch64`
(JDK 21, NDK 27.0.12077973). It was built after the Payment Drafts APK, one at
a time. Before the build: `npm test` 14/14 and the static build (20 pinned
files). APK sha256
`bcf9e739e73f3f25f41d611060fd216fbdbb9838d3e04153fee84a3ad3bf2760`, 21,733,964
bytes (`apk-sha256.txt`).

**Device.** The same emulator and boot as Payment Drafts
(`../../payment-drafts-awai3157-20261118/apk-vm/build.txt`): API 35
`sdk_phone64_arm64` userdebug, wiped at start. WebView `124.0.6367.219`. App UID
10149. The emulator was stopped right after the run (2026-11-17T23:52:54Z).

## Permissions

`aapt2 dump permissions` (`permissions.txt`): the only permission is
`network.itonami.securitiesdrafts.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`
(AndroidX). There is no `INTERNET`. `dumpsys package` on the device lists that
same permission as the only one granted.

## Network: per-UID traffic for 60 s after a cold start

The network was on. Payment Drafts had been force-stopped before this run.
`mAppUidStatsMap` was read just before the cold start (`launch-epoch.txt`) and
again 60 s later, with the app idle.

| UID | Result |
|---|---|
| App 10149 | No row in either snapshot: 0 bytes |
| WebView renderer (isolated, 99xxx) | No row in either snapshot |
| WebView service 10108 | 58,383 rx / 7,894 tx before and after: unchanged |

Only UID 0 moved in that window, by 56 bytes tx. The 10108 bytes came from the
first-run variations seed during the Payment Drafts run on this device; see that
record.

## Launch and screens (en-US, driven through the WebView DevTools socket)

| Check | Result | File |
|---|---|---|
| Cold start | `Status: ok`, `LaunchState: COLD`, 1145 ms | `launch.txt`, `f01-launch.png` |
| sese.023 with the awai-securities-ops fixture values (ISIN typed in lower case) | No field errors; preview has `<ISIN>US0378331005</ISIN>` and `<Amt Ccy="USD">18950.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>`; both L1 checks "Pass"; saved | `f02-l1-pass.png` |
| Import the profile's `semt002-statement.xml` | "Imported." | — |
| Holdings: `US0378331005 100.00`, `JP3633400001 -3`, `DE0007164600 10` | "1 match, 3 to check"; DE… — / 10 Not in the statement; GB… 50 / — Not in your record; JP… -2.5 / -3 Quantity differs; US… 100 / 100 Match (the same as the browser run and the profile's lines) | `f03-holdings.png` |
| Approve | "Approved. Nothing has been sent.", chip "Approved, not sent". The item approved was the first in the list, the imported custody statement; the settlement instruction stayed "Draft". Both kinds use the same approve path. | `f04-approved.png` |
| A stored item's kind changed to `order`, wait 8 s, force-stop, relaunch | Read-only notice; "Check and import" disabled; storage byte-identical after the views rendered | `f05-read-only.png` |

## Not covered

- Release signing, store distribution, physical devices, reboot persistence, TalkBack, Japanese locale on the device, tablet width.
- The paired bot profile running against this app.
- Any custodian connection or order.
- L2 and L3 (ADR 0042 O3, O5).

## Build generations (history)

New builds are recorded as immutable `apk-vm-<yyyymmdd>-<shortsha>/` directories; this
`apk-vm/` (2026-11-18) is not rewritten.

| generation | source commit | sha256 (bytes) | permission check |
|---|---|---|---|
| `apk-vm/` (2026-11-18) | 671edcb | `bcf9e739e73f3f25f41d611060fd216fbdbb9838d3e04153fee84a3ad3bf2760` (21,733,964) | `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` only; no `INTERNET` (`permissions.txt`) |
| `apk-vm-20261123-9ab74d7e/` | 9ab74d7e | `b246bf08434302c8f8a6f793d8bb97f63cea35dbd19a1fd46f829e4929446062` (21,798,452) | `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` only; no `INTERNET` (`apk-vm-20261123-9ab74d7e/permissions.txt`); debug signing only, versionCode 1000 |
