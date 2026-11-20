# x402 Pay — emulator evidence (AWAI-3252, 2026-11-18)

Record only; do not rewrite.

## Build

`npx tauri android build --debug --apk --target aarch64` in `apps/x402` (JDK 21.0.1 Temurin, SDK 37, NDK 27.0.12077973, Tauri CLI 3.0.0-alpha.6), source commit 6add5c1 plus the regenerated `Cargo.lock` ordering. 1 min 34 s at host load average about 8–25.
Output `app-universal-debug.apk`, 21,727,843 bytes, sha256 `7e529a04…db986f46`, `arm64-v8a` only, minSdk 24, targetSdk 37 (`apk-permissions.txt`).

## Run 1 — debug APK `7e529a04…db986f46`

Android emulator `Awai_X402_AWAI3252` (API 35, `default/arm64-v8a`, same config as `Awai_Horei_AWAI3134`, created for this task; `device.txt`). Device locale en-US, so the UI is English. Network was not turned off; the APK has no `INTERNET` permission.

| Step | Result | File |
|---|---|---|
| Launch | Cold start 1.18 s, host reported as `Awai Shell / Tauri v3` (the `awai_host_info` IPC answered), Base Sepolia label | `01-draft.png` |
| Invalid input | Text entered into the address field by a mis-tap; the field shows "The address is 0x followed by 40 hexadecimal digits." and saving is refused ("Check the fields.") | `02-validation-error.png` |
| Draft | USD 0.01, payTo `0xA003…2D4E`, `/x402/counts`, "Count lookup": the 402 preview shows `scheme: transaction`, `network: base-sepolia`, `maxAmountRequired: "10000"`, USDC `0x036C…CF7e`; "Draft saved." | `03-preview-saved.png` |
| Persistence | After `am force-stop` and relaunch (1.23 s), Drafts lists the saved draft with its time | `04-drafts-after-restart.png` |
| External operations | The three planned operations are listed as Disabled | `05-operations.png` |
| Permissions | No `INTERNET`; only the AndroidX `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | `apk-permissions.txt` |
| Crashes | No `FATAL` / `AndroidRuntime` lines for the app | `logcat-x402.txt` |

The emulator was stopped right after the run (`adb emu kill`, about 2.5 minutes of runtime).

## Not covered

Japanese UI on Android (checked only by unit tests), Copy JSON and Delete taps, per-app socket accounting, release signing, Itonami Store install, physical devices, reboot persistence, TalkBack, Figma review. The English draft count shows a bare number ("1"); wording only.
