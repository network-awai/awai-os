# Payment Drafts — debug APK on the API 35 VM (AWAI-3285, 2026-11-18)

Record only; do not rewrite.

**Build.** The debug APK was built from awai-os main `671edcb` with
`CARGO_BUILD_JOBS=4 nice -n 10 npx tauri android build --debug --apk --target aarch64`
(JDK 21, NDK 27.0.12077973). Before the build: `npm test` 12/12 and the static
build (20 pinned files). APK sha256
`8bbea1ba79ba96683be2bf807b739c2d36d1e537f0994ebe5e4f1187cf95e991`, 21,736,705
bytes (`apk-sha256.txt`).

**Device.** Emulator `Awai_Drafts_AWAI3285`, created for this run from the
Isekai AVD configuration (`build.txt`): API 35 `sdk_phone64_arm64` userdebug,
3 GiB RAM, 2 cores, `-wipe-data -no-snapshot -no-window`. WebView
`124.0.6367.219`. App UID 10148. Securities Drafts was checked on the same VM
afterwards (`../../securities-drafts-awai3158-20261118/apk-vm/`). The emulator
was stopped right after the run (`emu kill`, 2026-11-17T23:52:54Z).

## Permissions

`aapt2 dump permissions` (`permissions.txt`): the only permission is
`network.itonami.paymentdrafts.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`
(AndroidX). There is no `INTERNET`. `dumpsys package` on the device lists that
same permission as the only one granted.

## Network: per-UID traffic for 60 s after a cold start

The network was on (a ping to 8.8.8.8 answered). `mAppUidStatsMap` was read
just before the cold start (`launch-epoch.txt`, 2026-11-17T23:47:31Z) and again
60 s later, with the app left idle.

| UID | Result |
|---|---|
| App 10148 | No row in either snapshot: 0 bytes |
| WebView renderer (isolated, 99xxx) | No row in either snapshot |
| WebView service 10108 (`com.android.webview`) | No row before; 58,383 rx / 7,894 tx bytes after |

The 10108 traffic is the system WebView's first-run variations seed, not the
app (`logcat-webview-variations.txt`):

- `Requesting new seed from IVariationsSeedServer`
- the `webview_service` process starts as u0a108
- `requestNetwork … asUid: 10108`
- `Fetched first run seed in 286 ms`

This is the same thing Isekai recorded on a freshly wiped device
(`../../isekai-awai3216-20261118/`). The app has no `INTERNET` permission, so it
cannot open a socket itself. Securities Drafts, launched later on the same
device, showed no change for 10108 because the seed was already there.

## Launch and screens (en-US, driven through the WebView DevTools socket)

| Check | Result | File |
|---|---|---|
| Cold start | `Status: ok`, `LaunchState: COLD`, 1148 ms | `launch.txt`, `f01-launch.png` |
| Draft with the awai-banking-ops fixture values (debtor IBAN typed with spaces) | No field errors; preview has `<IBAN>DE89370400440532013000</IBAN>` and `<InstdAmt Ccy="EUR">1250.00</InstdAmt>`; both L1 checks "Pass" | `f02-l1-pass.png` |
| Save, then approve on the Drafts screen | "Draft saved."; then "Approved. Nothing has been sent.", chip "Approved, not sent" | `f03-approved.png` |
| Stored draft status changed to an unknown value (`sent`), force-stop, relaunch | "The saved drafts are in a format this app cannot read. Saving, approving and deleting are off …"; storage byte-identical after the view rendered | `f04-read-only.png` |

The first tamper attempt was force-stopped before the WebView flushed
localStorage, so the app relaunched with the earlier state. The second attempt
waited 8 s before the force-stop.

## Not covered

- Release signing, store distribution, physical devices, reboot persistence, TalkBack, Japanese locale on the device, tablet width.
- The paired bot profile running against this app.
- Any bank connection or payment.

## Build generations (history)

New builds are recorded as immutable `apk-vm-<yyyymmdd>-<shortsha>/` directories; this
`apk-vm/` (2026-11-18) is not rewritten.

| generation | source commit | sha256 (bytes) | permission check |
|---|---|---|---|
| `apk-vm/` (2026-11-18) | 671edcb | `8bbea1ba79ba96683be2bf807b739c2d36d1e537f0994ebe5e4f1187cf95e991` (21,736,705) | `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` only; no `INTERNET` (`permissions.txt`) |
| `apk-vm-20261123-9ab74d7e/` | 9ab74d7e | `2637069876b59e9ac8e6cfc7138e3a6a7885d3b26e3727e007e697bf9acaaa28` (21,801,241) | `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` only; no `INTERNET` (`apk-vm-20261123-9ab74d7e/permissions.txt`); debug signing only, versionCode 1000 |
