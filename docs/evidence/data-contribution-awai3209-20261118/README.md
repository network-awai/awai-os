# Data Contributions — evidence of 2026-11-18 (AWAI-3209)

Record only; do not rewrite. App: [`apps/data-contribution`](../../../apps/data-contribution/README.md).
Parent: AWAI-3206. Rules: cloud-murakumo-api ADR-261118 (AWAI-3210) and ADR-261016.
Paired bot: `awai-data-contribution-rewards` (cloud-itonami/itonami-agent, AWAI-3208).

Host: macOS, Node v26.0.0, JDK 21, NDK 27.0.12077973. The host was heavily
loaded during every run (load average 96–220; several other sessions' emulators
were running).

## Source checks

| Check | Result |
|---|---|
| `npm test` (`node --test`, awai-shell host tests plus `test/model.test.mjs`) | 13 tests, 13 pass |
| `cargo test --lib` (desktop target) | 5 tests, 5 pass: Awai FS round trip, mismatch refusal, damaged block, CID decode, raw and JSON byte bodies |
| `npm run build` | 21 pinned files; the CSP `connect-src` of `index.html` and `tauri.conf.json` equals the one derived from the descriptor |

`test/model.test.mjs` covers:

- The CID derivation equals the server contract's value for the bot fixture.
- Refusals:
  - missing rights basis or consent, personal data, sensitive data, unsupported license;
  - shares that are not integers, or do not sum to 10,000;
  - duplicate IDs or DIDs;
  - a missing license grant;
  - missing or duplicate consents for depicted people.
- The descriptor declares exactly one operation, with `each-operation` consent. The submission matches its method and path. A different path or method is not allowed. With no approved operations, the broker has nothing eligible.
- The bot's `awai.training-reward-result/1` loads (750000 / 250000). Results that are marked paid, inconsistent, or of another schema are refused.
- State transitions and unreadable state.

## Browser (static build, local server, built-in browser pane)

`python3 -m http.server` on `127.0.0.1:8765` served a copy of `dist/`. Run order:

1. Saving with no rights basis was refused with "権利の根拠を選んでください。根拠のない提供は報酬の対象になりません。" Nothing was saved.
2. Saving with `own-work` gave status "未送信". The content CID was `bafkreid7cnmr27vb2dtz4rwu57wshqbzolqr774zpsewyjum62zzrkmp3e` (a 55-byte fictional text post).
3. **Send → Deny.** The consent dialog showed `murakumo.training` / `submit-contribution`, `POST /training/contributions` at `https://api.murakumo.cloud`, and the six data categories. After Deny:
   - the network log had **no request to `murakumo`**;
   - the status read "送信しませんでした。要求は出ていません。";
   - the stored contribution was still `draft`, with no attempt recorded.
4. **Send → Allow once was not performed.** The agent's attempt to press Allow was blocked by the session's safety classifier: approving the dialog is the participant's decision. The positive path (one approved request) is therefore **not verified**. Only its request shape is covered by the unit test.
5. Rewards:
   - a result with `:payout? true` was refused;
   - the bot result loaded and showed 750000 / 250000 with the chip "テスト段階・未払い".
6. Withdraw took two taps and set the status to `withdrawn`, with a time. No request was made.
7. The External operations screen lists one declared operation and four planned ones.

A race found here: a save that finished after the participant had moved to another view re-rendered the form over it. It was fixed before the APK build. The fix re-renders the form only if the participant is still on it.

## Android debug APK on the API 35 emulator (`apk-vm/`)

**Build.** The APK was built with `npx tauri android build --debug --apk --target aarch64` (`CARGO_BUILD_JOBS=4`, `nice -n 10`).

- First full build: 01:18:55Z–01:28:44Z.
- Then two incremental rebuilds: the race fix, and the Awai FS byte-body fix below.
- Final APK sha256 `99466d4d453bdc72cec15ebd9bd04600b3c25e86e73dc37678c51b624f3b6998` (`apk-sha256.txt`), 36,480,720 bytes. It contains one library, `lib/arm64-v8a/libdata_contribution_lib.so`.

**Permissions** (`permissions.txt`):

- `android.permission.INTERNET`, for the one consented operation;
- the AndroidX `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`.

**Device.**

- AVD `Awai_DataContrib_AWAI3209`, created for this run from the `Awai_Drafts_AWAI3285` configuration with 2 cores and 3 GiB RAM.
- Started with `-wipe-data -no-snapshot -no-window` on port 5730. Build: `Android/sdk_phone64_arm64/emu64a:15/AE3A.240806.019/12368160:userdebug/test-keys`. WebView `124.0.6367.219`.
- The emulator had no outside network (`ping` reported "Network is unreachable").
- It was stopped after the run (`emu kill`, `emulator-stopped.txt`).

**Driving.** The app was driven through the WebView DevTools socket:

- `cdp-eval.mjs` evaluates expressions in the page.
- `cdp-net.mjs` evaluates with the CDP Network domain enabled. It records every request the page starts during the step.
- The selected file was supplied with `DataTransfer`, standing in for the system file picker.
- Step outputs are in `step-*.json`.

| Step | Result | File |
|---|---|---|
| Cold start after `pm clear` and a later force-stop | `Status: ok`, `LaunchState: COLD`, 970 ms | `launch.txt`, `f01-launch.png` |
| Save with no rights basis | Status "Check the highlighted fields."; rights error shown; nothing stored; no request | `step-a.json`, `f02-no-rights-basis.png` |
| Save with `own-work` | Stored as `draft`. Statement CID `bafkreibvqtatsl7jyvgtplqs5syoulcxx3jlvklxexlieyl4w7evxijmx4`. Both blocks are in the app-private Awai FS (`awai-fs-blocks.txt`), and their sha256 values, read back with `run-as`, match the CIDs | `step-b.json`, `f03-saved-list.png` |
| Send | Consent dialog open, showing the full scope; **no request** | `step-c1.json`, `f04-consent.png` |
| Deny | Dialog closed; "Not sent. No request was made."; still `draft`, no attempt; **no request** in the following 5 s | `step-c2.json`, `f05-denied.png` |
| Rewards | A paid result was refused; the bot result was loaded (750000 / 250000, unallocated 0) | `step-d.json`, `f06-rewards.png` |
| Withdraw | First tap armed it ("Press again to withdraw"); the second recorded `withdrawn` at `2026-11-18T01:48:46.553Z`; no request | `step-e.json`, `f07a-withdraw-armed.png`, `f07-withdrawn.png` |
| External operations | One declared operation, four planned | `f08-operations.png` |

The only requests the page started in any step were `GET https://tauri.localhost/icon.png`. That is the app's own bundled icon, which the WebView re-requests on a URL change (Horei notes the same).

### Found on the device and fixed

The first save on the device failed with `raw-body-required`. The Android IPC delivered the `Uint8Array` that `awai_fs_put` receives as a JSON array, not as a raw body. The host now accepts a raw body, or a JSON array of byte values of at most 16 MiB; anything else is refused (`byte-body-required`). There is a unit test for it. Horei's `awai_fs_put` has the same raw-only check. Whether Horei's put works on Android was not checked here.

### ANR during the first run

The first install was launched with `am start -W` and timed out after 45 s. After a reinstall and `pm clear`, the cold start took 18.6 s. During that run, Android recorded one ANR for the app at 10:42:13: "Input dispatching timed out … Waited 5001ms for FocusEvent" (`anr-events.txt`, `anr-trace-20261118-104214.txt`). In the trace, the main thread was inside `Choreographer.doFrame` → `nativeGetLatestVsyncEventData`, waiting in the runtime, not in app code.

`com.android.phone` and the media provider also ANRed at startup on the same emulator. A later `kill -3` stack showed the main thread idle in `Looper.pollOnce`.

The ANR dialog kept being re-shown for that single event (up to 10 stacked windows). After `am force-stop` and a relaunch, the app cold-started in 970 ms and showed no further ANR through the whole run. The evidence points to CPU starvation of the 2-core guest on the loaded host, but the cause is **not established**. Repeat the launch on an unloaded host or a device before calling it settled.

## Not done

- **The approved send (Allow once) was not run.** It needs the participant's own approval in the dialog. In the current state it cannot succeed in any case:
  - `/training/*` is not served in production (`GET /training/policy` → 404);
  - the route needs a registered human bearer session, which is a planned operation;
  - the route does not read `rightsRecord` yet (AWAI-3210 follow-up).
- No upload to Yataverse, server-side withdrawal, or server reward read. These are planned operations, not declared.
- Release signing, Itonami Store and `dapps.json` (AWAI-3211), physical devices, Japanese-locale screenshots on the device (the device ran en-US; Japanese was checked in the browser), Figma design review, TalkBack.
- No CI job builds the Tauri apps in this repository.
