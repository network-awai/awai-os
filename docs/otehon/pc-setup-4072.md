# Awai OS PC setup — AWAI-4072

Tracking: [AWAI-4072](https://linear.app/kotobalabs/issue/AWAI-4072), built on the
shared SetupWizard semantics of [AWAI-3004](https://linear.app/kotobalabs/issue/AWAI-3004)
(`docs/otehon/android-shared-setup.md`).

## What ships

PC Welcome/language/network/date-time wizard + desktop (apps/settings visible,
no blank desktop, no residual LineageOS branding), plus screensaver/wallpaper,
integrated with mobile SetupWizard semantics.

| Item | Implementation |
| --- | --- |
| PC wizard UI | `android/client/setup.js` `showPC()` (Welcome→language→network→datetime→account→privacy→lock→done) |
| PC stage contract | `android/contracts/src/itonami/store/pc_setup.cljc` — same indices as `setup.cljc`; hardware-adaptive transports |
| Native snapshot | `SetupPlatform.pcSnapshot()` in `android/home/.../SetupPlatform.java` — locale/timezone/validated + `isPC`, `hasEthernet/hasWifi/hasTethering`, `profileTransferUnavailable` |
| Native transition | `pcTransition()` — stages 1/2/3 addressable on PC (retired on mobile by AWAI-3049); account still requires `defer`/`linked`, finish requires `secure` |
| Bridge | `HostActivity.Bridge` `pcSetupSnapshot/pcSetupTransition/setupSettings/setAwaiWallpaper/openScreensaverSettings`; `setupSettings` extended (`ethernet`, `wallpaper`, `screensaver`, `appearance`) |
| Desktop topbar | `client.js` `home()` — `pc-topbar` (設定 / 壁紙 / スクリーンセーバー) + always-visible dock/search/apps; `.pc-desktop` class drives `client.css` |
| Wallpaper/screensaver | `AppearanceActivity` — desktop+lock via `FLAG_SYSTEM|FLAG_LOCK`, screensaver picker via `Settings.ACTION_DREAM_SETTINGS`; `HostActivity.setAwaiWallpaper("both")` |
| Keyboard/mouse focus | `setup.css` `:focus-visible` on `.setup-page.pc`, headings `tabindex=-1` with focus on stage change, 48px+ rows |
| Honest profile transfer | `pc-setup/profile-transfer = :unavailable`, `honest-profile-copy` Japanese note; shown on PC stage 4; finish never fabricates `connected/authenticated/restored` |
| Itonami APK | No provisioning writes. `pcSnapshot` reports `osProvisioning:false`; no `DEVICE_PROVISIONED` / `user_setup_complete` writes anywhere (verified by tests). Shell signing stays ordinary app. |

Settings APIs own locale/connectivity/date-time/enrollment; the wizard only
opens native Settings and verifies readback. Back/forward `next`/`back` preserve
non-secret selections; process-death safe via `pc-setup-v1` prefs (jurisdiction:
bounded, never PIN/keys).

## Parity with AWAI-3004

- Figma 241-3 setup reuses: same 8 stages, same titles/subtitles, same 180 ms dissolve / 0.6 s Welcome behavior via `setup.css`.
- Mobile stays at Welcome→account→privacy→done (AOSP owns 1/2/3/6); PC re-uses 1/2/3/6 as visible steps because the PC SetupWizard item is still present on the image and the PC form factor makes keyboard/mouse Settings delegation natural.
- `next-action` / `pc-complete?` mirror the same finish gate: `secure && (deferred|linked)`.

## Evidence

- `android/client` rebuild: `clojure -M:build` → `generated/domain.js` (includes `pcSetupStage/pcSetupNext/pcSetupTransports/pcProfileUnavailable`).
- JS: `node --test android/tests/*.mjs` → **94/94 pass** including new `pc-setup.test.mjs` (6).
- Contracts: `clojure -Sdeps '{:paths ["contracts/src" "contracts/test"]}' -M -e "(require 'itonami.store.pc-setup-test 'itonami.store.domain-test) (clojure.test/run-tests ...)"` → **8 tests, 41 assertions, 0 failures**.
- Instrumentation: `SetupInstrumentation` extended with PC checks (isPC, profileTransferUnavailable, osProvisioning false, PC language/network/datetime addressable, back, defer). Requires disposable emulator — not run in this worktree; to be run via `android tests` lane on an emulator host.

## Remaining gates (not claimed)

- VM/emulator run of the full PC Welcome→done flow; physical 6600H LAN boot.
- TalkBack / large-text / touch on PC; Japanese/English roundtrip visual.
- Account handover: phone approval + encrypted profile transfer remains unavailable/defer per honest copy.
- Privileged ROM integration / SetupWizard APK replacement is out of scope for this PR — Home hosts the PC wizard as an ordinary app; no ROM flashing.
