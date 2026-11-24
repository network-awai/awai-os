# AWAI-3890 — x402 on-device evidence (moto g05, 2026-11-25)

Linear: https://linear.app/kotobalabs/issue/AWAI-3890 (acceptance steps 4–5: on-device
screenshots, evidence in `docs/evidence/x402-<date>/`).

Code state: `origin/main` `1fe377d5` (fixes #455/#456/#457/#461/#470 already merged;
this branch adds evidence only — no `apps/x402` code change). awai-os Actions are
disabled, so nothing here is "checks green": local totals only.

Build / test totals (this machine, branch `awai-3890-x402-device-evidence`):

- `packages/awai-ui`: `npm ci && npm run build` — exit 0
- `apps/x402`: `npm ci && npm test` — **17 tests, 17 pass, 0 fail**
  (`node --test ../../packages/awai-shell/test/*.test.mjs test/*.test.mjs`)
- `apps/x402`: `npm run build` — `x402 Pay static build: 20 pinned files`, exit 0
- APK: `npx tauri android build --debug --apk --target aarch64` — `Finished 1 APK`,
  `app-universal-debug.apk` 21,821,477 bytes,
  sha256 `24bfca5a8c3b357bc87037a6ee8e9232f97945ed0cedac362fcc95c560725eb2`;
  installed `base.apk` pulled back and re-hashed identical. `aapt2 dump badging`
  / `dump permissions` (36.0.0 + 36.1.0) and the manifest permission set: no
  `INTERNET` — only Tauri's own `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`
  (`apk-permissions.txt`, `apks-badging.txt`). Debug-signed
  (`apk-apksigner.txt`: `CN=Android Debug`).

Device, launch and cleanup: see `device.txt`. Cold start
`am start -W`: `TotalTime 848` (first install) and `865` after `am force-stop`
(relaunch); `logcat-launch.txt` shows `Displayed … .MainActivity for user 0: +848ms`
/ `+865ms`, `ANR in network.itonami.x402` = 0, `FATAL EXCEPTION … network.itonami.x402`
= 0. The app was uninstalled afterwards (`pm list packages` absent) and rotation /
night-mode settings restored.

Driving note: taps were done through the WebView DOM (CDP over
`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`): fill field →
dispatch `input` → click submit / nav link. Physical `input tap` was not used
(WebView hit-area pitfall); every screenshot was preceded by a
`topResumedActivity` check naming `network.itonami.x402/.MainActivity`. The device
was rotated to portrait for readable screenshots (`accelerometer_rotation`/`user_rotation`
restored after).

## Per-item results

### (1) 保存データの上書き — on-device proven

- Created 3 drafts through the real form (CDP set + save click) into the draft
  list (`01-drafts-before-force-stop.png`: `保存した下書き` / `3件`,
  `0.01/0.02/0.03 USD`, `/evidence-draft-1..3`, `evidence draft 1..3`).
- `adb shell am force-stop network.itonami.x402`, cold relaunch, drafts view
  again `3件` / 3 items (`01-drafts-after-force-stop.png`): the saved drafts
  survive process death, nothing overwritten or truncated.
- Draft form open with unsaved input (`01-draft-form-open.png`), then
  `location.reload()`: the form resets to module defaults
  (amount `0.01`, resource `/`, description empty — verified via DOM read) and
  the drafts view still `3件` / 3 items (`01-drafts-after-reload.png`); i.e. a
  reload while a draft is open does not touch stored drafts.
- The three list screenshots are byte-identical (sha256
  `fa9af86e…`, listed in the PR / hash list): the list screen genuinely did not
  change — that equality is the point. (Unsaved form input resetting on reload
  is expected: only saved drafts are stored state.)

### (2) 上限の無言失敗 — on-device proven (all four limits)

Each violation was entered and submitted; the screen states the specific reason
(field error under the field + status line), no silent failure:

- amount > USD 1,000 (`1001`): `下書きの上限は 1,000 USD です。`
  (`02-limit-amount-over-1000.png`; DOM `amount-error` text identical,
  invalid field `amount`).
- amount with 7 decimals (`0.0000001`):
  `金額は 0.01 のように、小数 6 桁までの数で入力してください。`
  (`02-limit-amount-7-decimals.png`).
- resource not `/path` and not `https://…` (`http://example.com/page`):
  `対象リソースは / で始まるパスか https の URL にしてください。`
  (`02-limit-resource-http.png`).
- 51st draft over the 50-draft cap: status line
  `下書きは 50 件までです。不要な下書きを削除してから保存してください。`
  (`02-limit-drafts-full-50.png` — shot scrolled to the status line; drafts
  list stayed `50件` / 50 items after the refused save, so the over-cap draft
  was not silently saved either).

### (3) 起動時エラーの非表示 — not proven on-device

No real startup failure was triggered on the device: there is no product-code
backdoor to corrupt the stored envelope from the UI, and hacking the app to
force a boot failure would mean shooting evidence of a modified build, so no
screenshot of a startup error exists. What is true on-device is the other side:
normal start shows a non-blank UI immediately (`03-start-normal-dark.png` —
title, environment line and the draft form all rendered; `Displayed +848ms`,
no `FATAL`/`ANR` for the package, see `logcat-launch.txt`). The
error-visible-on-startup contract itself is covered by the repro test
`(a/c) undecodable stored drafts go read-only with the error on screen`
(boot harness in `apps/x402/test/repro-3890.test.mjs`, 17/17 pass), not by a
device screenshot. **Do not read (3) as device-verified.**

### (4) システムバー色 — on-device proven (light, dark, live switch)

- Light: `adb shell cmd uimode night no` → `04-system-bars-light.png`.
- Dark: `adb shell cmd uimode night yes` → `04-system-bars-dark.png`.
- Live switch: both shots show the same `ActivityRecord … t207` as
  `topResumedActivity` before and after each switch — the theme change applied
  without recreating the activity, matching the `uiMode` `configChanges` entry.
- Measured bar colours (pixel-sampled from the PNGs): light status bar and nav
  bar `#FFFFFF` (255,255,255), dark both `#14110F` (20,17,15) — exactly
  `style.css` `--bg` (`#fff` light / `#14110f` dark). Icons read dark-on-light
  in light mode and light-on-dark in dark mode (black time/Wi-Fi/battery on
  white; white time/Wi-Fi and green battery on `#14110F` — visible in both shots).

## Files

- `01-drafts-before-force-stop.png`, `01-drafts-after-force-stop.png`,
  `01-draft-form-open.png`, `01-drafts-after-reload.png`
- `02-limit-amount-over-1000.png`, `02-limit-amount-7-decimals.png`,
  `02-limit-resource-http.png`, `02-limit-drafts-full-50.png`
- `03-start-normal-dark.png` (normal start; not a startup-error shot)
- `04-system-bars-light.png`, `04-system-bars-dark.png`
- `device.txt`, `logcat-launch.txt` (package-scoped launch lines),
  `apks-badging.txt`, `apk-permissions.txt`, `apk-apksigner.txt`
- `apk-sha256.txt` — one line, sha256 + file + bytes of the built APK
  (the APK binary itself is not committed; it can be rebuilt with the command above)

Cleanup: the app is uninstalled from the device; the only branch changes are
this directory. `apps/x402` and `apps/isekai` are untouched.
