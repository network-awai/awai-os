# Soudan — build and emulator evidence (AWAI-3321, 2026-11-18)

Record only; do not rewrite.

## Build

| Check | Result | File |
|---|---|---|
| `npm test` | 15 tests, 0 failures (includes `packages/awai-shell`) | `npm-test.txt` |
| `npm run build` | 20 pinned files; descriptor valid with `operations: []`; both CSPs `connect-src ipc: http://ipc.localhost` | — |
| `cargo check` | Finished, no errors | `cargo-check.txt` |
| Debug APK `npx tauri android build --debug --apk --target aarch64` | First run failed at Kotlin compile: `TauriActivity.kt` could not resolve `app.tauri.plugin.PluginManager` because the generated `tauri.build.gradle.kts` / `tauri.settings.gradle` were written during that run. The second run, with no source change, succeeded. | `apk.sha256` |
| APK permissions | No `INTERNET`; only the AndroidX `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | `apk-permissions.txt` |

APK sha256: `7d4e6240a350d2617e2e997033c0a1bf6a96b007040fca6a985d7f517012ff19`.

## Emulator run

Android emulator `Awai_Soudan_AWAI3321` (API 35, `default/arm64-v8a`, created for this task; device locale en-US, so the UI is English). The host was heavily loaded: load average about 227 on 10 cores, with five other emulators running.

1. **First launch — wry panic.** The app panicked in wry `android/main_pipe.rs:389` with `SendError` and was killed.
2. **Second launch — killed during startup.** Android killed it with "failed to attach / start timeout".
3. **Third launch — ran.** The WebView painted after about 3 minutes.

During the run, another session installed and launched `cloud.itonami.agent` on this emulator. That app was left alone. The earlier crash is not shown to be load-only; it is recorded as **not reproduced/not explained**.

The input was set through WebView DevTools (`Runtime.evaluate` setting field values and dispatching `input`/`change` events), not typed on the screen keyboard.

| Step | Result | File |
|---|---|---|
| Launch | Host `Awai Shell / Tauri v3`; input form; jurisdiction and area both "Choose" (no default) | `01-launch.png` |
| Make the memo | Japan / Money lent or owed / summary / wish / name / contact → `#/memo`; draft saved on the device as revision 1 | `02-memo.png`, `flow.json` |
| Recipient and confirm | Lawyer name and contact typed, "I checked this memo and the recipient" ticked; **Send stays disabled** with "There is no way to send yet" | `03-recipient.png`, `flow.json` |
| Requests made by the page | 11 resources, all `http://tauri.localhost/…`; no other host | `flow.json` |
| Sockets | App UID 10148 owns 0 tcp/tcp6/udp/udp6 sockets; no `INTERNET` permission | `sockets.txt` |

## Not covered

- Sending (X1) and the lawyer's return path (X3): not declared.
- The lawyer-side screens.
- The Japanese UI on Android: checked in a browser against the same `dist/` only.
- Typing with the on-screen keyboard.
- Release signing.
- Store install (AWAI-3238).
- Physical devices.
- Reboot persistence.
- TalkBack.
- Figma review.
- The first-launch wry panic.
