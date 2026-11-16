# Android setup: source and partial VM qualification

Tracking: [AWAI-3004](https://linear.app/kotobalabs/issue/AWAI-3004), [PR160](https://github.com/network-awai/awai-os/pull/160).
Product direction: [AWAI-3007](https://linear.app/kotobalabs/issue/AWAI-3007); AOSP is the phone/desktop basis, existing Nix retained.

This implements first-run setup inside the existing ordinary Home APK. It does not replace privileged AOSP/Lineage SetupWizard, write Android provisioning flags or install a new ROM. The current implementation supports explicit account deferral, not verified phone enrollment or new-profile creation.

## Implemented

- Editable Figma241:3–241:442 translated into the existing shared browser host: Welcome, locale/region, validated network/offline, date/time, account/defer, privacy, native screen lock and completion.
- Android Settings owns global locale/network/date-time/PIN. Only a fixed action enum is exposed. Native readback uses `NET_CAPABILITY_VALIDATED` separately from association and `KeyguardManager.isDeviceSecure()`, never an Activity result or browser checkbox alone. No PIN/password/private key is collected by Awai.
- Native private preferences persist bounded stage/offline/defer/completion state. Expected-stage validation rejects stale/unknown commands, account completion cannot be invented, and Home completion requires observed device security. A non-Home host cannot invoke setup mutations.
- Android Tauri Itonami source starts at sign-in rather than replaying Hello/locale/Nix network. Returning-user and existing-account authentication remain intact. This changed shell has not yet been packaged/deployed as a revised Android Itonami APK.
- System Back and on-resume readback preserve non-secret choices. Account entry shows unavailable/defer rather than a fake QR or enrollment receipt. Store and Yotei do not start this Home setup flow.

## Evidence

| Scope | Observed result |
| --- | --- |
| Shared compiled domain/catalog | 8 Node tests pass, including unvalidated connectivity, explicit offline, missing PIN and unlinked account refusal |
| Actual CLJS shell advanced compilation | setup-check passes, including Android initial-step matrix and phone-sign-in QR regression; no owner identity or relay request |
| Native API35 emulator boundary | 13 assertions pass before PIN enrollment; 12 conditional assertions pass after native lock enrollment. These are overlapping tests, not25 independent acceptance units |
| VM screen operation | Welcome→language entry→native language Settings; Japanese added to preferred languages, primary locale remains en-US; network/date-time→account unavailable/back/defer→privacy→native PIN entry/confirmation→lock readback→completion→existing Home |
| App restart | Force-stop/start preserves stage7, `complete=true`, account deferred; secure lock remains observed. This is not OS reboot qualification |
| Test isolation | Instrumentation requires explicit disposable scope and emulator hardware. It clears only this test installation's setup progress before reporting completion; verified preferences empty afterward |
| Device change | None to10.77.0.2:5555 or the attached Moto. Owner's Nix/EFI/keys/services untouched |

VM: separate task-owned arm64 Android API35 AOSP default emulator,1440×900/density160, installed SDK image35r02. It is not the Generic x86_64 physical image. SDK repository metadata and installation log are preserved locally; SDK archive checksum declared by official metadata is SHA1 `2026a06409db630b56711afdbffb457c1dbaed49`. No new Google account or Play services used.

Built/signed `home-v8.apk`:4,165,254bytes, SHA256 `689ff359d1891f3f178f5e741b3f98be12c6ba3c814db9a02b92f9ba1708cb4f`; development signer only. Local `.agent-output/` retains build logs, SDK metadata, VM config/disk, screenshots and UI dumps. PIN/owner credentials are not included in this report. The test used a disposable VM credential, never the owner's.

## Visual assets and motion

Original ambient artwork exact SHA256 `4637ce4a054ea77ddf427889b2eff1b54c71df380aec4bd4cdea3ad8095f6fef` matches the existing local wallpaper. Figma original logo is `setup-logo.png`, SHA256 `e64357d85ec32fbbb8ab9c087b60637e97779db64c9d4e2a18146bba80481347`; the existing startup mark is a different asset and was not substituted. Exported lock SVG retains its native24px slot. Existing settings/Wi-Fi/phone SVGs are reused.

Setup bundles a132KiB WOFF2 subset of the installed Noto Sans JP variable font (source SHA256 `d0a07584de49d2e79ed831cea5aa2f18086986e0bccf8b0c3742b36408bf3de7`) with its SIL OFL. Subset input is setup.js text plus ASCII/kana; dynamic glyphs can fall back to system CJK. The OFL copy came from Google Fonts revision `7af0d90b4d532ffa4b041937b560c6df4e7b1e95`. Desktop panel/hero geometry was compared with Figma; native system bars reduce the actual viewport. Japanese-primary and large-text visual acceptance remain open.

Figma motion context emits a2s opacity timeline with a0.6s fade followed by a hold and an infinite-loop default. Implementation deliberately uses one iteration for first-run Welcome, preserving the supplied keyframe/easing values, so setup does not repeatedly disappear. Reduced motion/native power-save renders the final static state immediately. This interpretation needs design review; no particle UI is adopted.

## Remaining gates

Actual phone/Passkey/wallet enrollment and encrypted profile transfer, new-profile creation, Japanese-primary/global-locale roundtrip, lost Internet/captive-portal UI, accessibility/focus/large text, OS reboot/unlock, privileged ROM integration, revised Itonami APK packaging and6600H device acceptance remain open. Accordingly the requested full VM gate has not passed and physical apply is withheld. Browser or native test fixtures cannot stand in for these outcomes.

Issue/run: AWAI-3004 / thread01a1e3f0-1dde-7af3-a093-2a8257f6eb56 / branch codex/awai-3004-android-setup, source checkpoint563d842. Provider/model/settings, estimate/unit, calibrated token forecast, attributable token/cost and active/wait measurements remain unknown. Repeated assertions are not summed into velocity or percent completion.
