# Android setup: source and partial VM qualification

Tracking: [AWAI-3004](https://linear.app/kotobalabs/issue/AWAI-3004), [PR160](https://github.com/network-awai/awai-os/pull/160).
Product direction: [AWAI-3007](https://linear.app/kotobalabs/issue/AWAI-3007); AOSP is the phone/desktop basis, existing Nix retained.

This implements first-run setup inside the existing ordinary Home APK. It does not replace privileged AOSP/Lineage SetupWizard, write Android provisioning flags or install a new ROM. The current candidate connects the existing signed phone/wallet/Passkey link protocol and retains explicit account deferral. Real owner approval and encrypted profile transfer are separate acceptance gates.

## Implemented

- Editable Figma241:3–241:442 translated into the existing shared browser host: Welcome, locale/region, validated network/offline, date/time, account/defer, privacy, native screen lock and completion.
- Android Settings owns global locale/network/date-time/PIN. Only a fixed action enum is exposed. Native readback uses `NET_CAPABILITY_VALIDATED` separately from association and `KeyguardManager.isDeviceSecure()`, never an Activity result or browser checkbox alone. No PIN/password/private key is collected by Awai.
- Native private preferences persist bounded stage/offline/defer/completion state. Expected-stage validation rejects stale/unknown commands, the account preference is only a flow marker, and Home completion requires observed device security plus browser-verified linkage or explicit deferral. A non-Home host cannot invoke setup mutations.
- Android Tauri Itonami source starts at sign-in rather than replaying Hello/locale/Nix network. Returning-user and existing-account authentication remain intact. This changed shell has not yet been packaged/deployed as a revised Android Itonami APK.
- System Back and on-resume readback preserve non-secret choices. Account entry uses a real signed-link request/QR and the exact existing verifier, with explicit deferral and no fabricated enrollment receipt. Store and Yotei do not start this Home setup flow.

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

## Continuation: real link candidate and Japanese cold boot

Current source unit reuses the owning shell’s `awai.link.v1` implementation and non-exportable P-256 device key, verifies actual local key possession, and bundles only the existing protocol dependencies. The pinned canonical broker remains unchanged. Home grants one fixed HTTPS relay GET route, no query/fragment/credentials or redirects; native URL filtering and CSP independently bound it. Saved linkage is reverified on loading; a native `linked` marker without valid browser proof cannot open Home. Home/Itonami identity-store synchronization and profile-data transfer remain open.

- Local combined source tests: **28 pass**, covering signed link alteration/expiry/wrong-device rejection, real WebCrypto key possession/mismatch/exportability, strict relay routes, setup state and catalog behavior. These are source tests, not real-account acceptance.
- Candidate `home-v11.apk`: **4,193,990 bytes**, SHA256 `581b3dfab8033b49046fc14ea3a945eb50ef518faf736dbed7f1844865d484a7`; installed only on the disposable API35 emulator. Build manifest records identity source/verifier/device digests and the exact runtime pin. Development signer only.
- Japanese was selected and confirmed through Android’s actual language Settings dialog. After a full emulator process stop/start without snapshots, `persist.sys.locale=ja-JP` and native setup readback `locale=ja-JP` remain. This supersedes the earlier en-US partial result above.
- Cold-boot keyguard was unlocked through Android’s actual PIN interface using the disposable test credential. Readback reports `deviceLocked=0`, `strongAuthRequired=0`, and `secure=true`; no credential reset, root unlock or bypass was used. An earlier intermediate readback was taken before asynchronous unlock completed. Input commands now explicitly target display0 on this multidisplay emulator.
- Home v11 runs after unlock and displays the existing Japanese setup composition. The actual canonical relay-consent dialog is visible in the Mac emulator. Owner consent/signature has been requested, not synthesized. The real-account→completed Home→another OS reboot restoration gate is still pending.
- No candidate APK or boot/storage change has been applied to6600H. Physical apply remains conditional on the requested complete VM gate. The attached Moto is excluded.

The earlier 12-assertion native instrumentation result was on v9; it is not relabeled as v11 acceptance. Full VM real-account restoration, native boundary rerun, Itonami packaging, physical acceptance, privileged SetupWizard/ROM integration, FBE/hardware-backed custody and profile sync remain distinct gates. Provider/model/settings, issue estimate/unit, attributable token/cost and active/wait telemetry remain unknown.

## Verified VM acceptance and conditional physical application

The owner directly approved the canonical relay operation and completed an actual phone **Passkey** signature. The browser verifier accepted it, setup reached `stage=7`, `complete=true`, `account=linked`, and rendered Home. The test exports neither the signed proof nor an account identifier; local before/after digest comparison confirms the same saved proof.

| Requested VM acceptance | Verified observation |
| --- | --- |
| Actual account linking | Existing phone Passkey signature verified by the owning awai.link.v1 verifier; no fixture identity |
| Japanese system language | `ja-JP` in actual Android/native readback after OS reboot |
| Native PIN | Actual Android PIN enrollment and keyguard unlock; `secure=true`, `deviceLocked=0` |
| Restart retention | Real OS boot ID changed; proof digest matched; non-exportable device-key possession and signature reverified |
| Default Home startup | Android RoleManager dialog selected Awai Home; role/package resolver confirms `network.awai.home`; another OS reboot/unlock automatically started Home, without `am start` or a HOME key after unlock |
| Native adapter | v11 target with current instrumentation:12 conditional assertions pass. Setup preferences reset only on the disposable emulator, then the already verified account was reused through the actual UI; key/session storage retained |

The keyguard UI must be observed focused before credential input; an immediate post-boot command can arrive before the PIN screen is ready. Emulator screen wake was required while testing. Intermediate asynchronous `deviceLocked=1` readbacks are not treated as failures after the later observed unlock, and no credential bypass/reset was used.

After this VM gate passed, the exact v11 APK above was installed on the verified physical target (`0c:47:a9:60:9d:34`) and Home’s setup screen visibly rendered. The existing physical installation had no `network.awai.home` package; its package/role/build inventory was preserved first. No app data, old Itonami state, keys, partitions or EFI entries were overwritten. The default Home role is still the existing OS wizard until actual physical setup is complete.

Physical readback remains **en-US**, account unlinked, `secure=false`, and LAN associated with **no validated Internet/default route**. Physical phone enrollment/PIN/Home completion is not claimed. This is the existing unofficial Generic x86_64 Android17/API37 diagnostic Live image, with `/data` on tmpfs; a reboot loses RAM state. It is not a persistent Android install and Nix/NVMe are retained. No physical reboot is performed as a persistence test on this RAM image.

CI now includes a separate Otehon source-check step for the deterministic identity bundle and the28 source tests. These checks do not use accounts, relay access, an emulator or physical hardware; they cannot replace the runtime evidence above. CI status is reported from GitHub separately.

## Itonami packaging and physical readback

The owning shell was rebuilt from committed revision `6b54a16041225a61b1dd290813e5e6412d9d040e` (shell tree `88e1063c2d591b9d9c204f781a1bedb364b19885`) and packaged through the pinned Tauri3 alpha6 builder. The existing Android entry-policy change now ships: both the ARM64 API35 VM and x86_64 physical app start directly at **サインイン**, omitting Hello/language/Nix network repetition. The existing Core/Apps/System UI source is retained; authenticated desktop acceptance is separate.

- ARM64 test APK:30,711,688bytes; SHA256 `1af92623b824f5bf2a396dbfd98468f265cf5e0ac91081abbc3aa02962af9473`.
- x86_64 physical APK:32,645,005bytes; SHA256 `adb199139fdcb44703329dbdc0f37fb4b3f7d5a704c8ce281d38befe18df9527`.
- Both retain development version0.1.0/code1000 and the existing Android debug signer. Distinguish candidates by these artifact hashes and embedded source manifests, not the unchanged display version.
- Actual VM and physical WebViews independently read the same embedded manifest/source revision and `assets/main.js` digest `e8a3f0fd82fdb4311e6e62798d9856fec70eb072d496fe2a62736bd13cae3f6f`. The live origin remains `https://tauri.localhost`. The prior installed physical APK was pulled and hashed before the `-r` update; no app-data clearing, origin change, identity copy or re-signing occurred.
- The exact canonical runtime/CSS were independently re-read from their owning GitHub repository at pin `91ed14c090c90ceff833a868f1685c8840503f76`, `lib/kotoba.wasmWebcomponent/src/`; bytes and SHA256 match the vendor pin. No product-local consent implementation was substituted.

Physical language Settings now selected/confirmed **ja-JP**. The current owner setup is paused at network: Wi-Fi is enabled and scan choices render in Japanese, but association/Internet and physical enrollment/PIN are not yet accepted. Settings initially remained behind Home; it was explicitly brought to front after the owner reported no input screen. Selecting a connection opens the native password dialog; no network password is requested in chat.

The physical diagnostic image recorded repeated `SYSTEM_RESTART` entries preceded by `system_server_lowmem`, including before Home was installed. At inspection the kernel still had about15GiB available, no current PSI pressure and no captured kernel OOM-kill line. Therefore the restart cause is **not established** as physical RAM exhaustion or an app regression. A later sample retained the same system_server PID while Japanese settings and Itonami rendered. Root-cause/stability qualification remains open; do not wipe credentials/data or disable protection to hide it.

GitHub reports repository Actions `enabled=false`, with no runs/checks for this PR head. CI source commands passed locally; there is **no remote CI pass**, and repository Actions was not enabled as a side effect. PR160 remains draft/open. The task worktree, AVD and unique build/runtime evidence are retained; no worktree or credential cleanup was performed.

A final Home UI-only correction maps the existing exported Wi-Fi icon (instead of an undefined asset path) and describes account linkage without promising unimplemented profile-data transfer. `home-v12.apk` is4,193,990bytes, SHA256 `a83d4decfe32825511fc10c9e90ef472693cdf1ee6bb4973dba6ea4de57ab7e7`. Identity/verifier/device/runtime hashes are unchanged from v11. The28 source tests pass; upgrade on the VM retains the verified Passkey account, secure lock, ja-JP and completed Home. This does not relabel the v11 reboot test as a v12 OS reboot test. The same v12 APK was then applied to the physical device without clearing app data. The owner’s connection choice/password remains pending.

## Network step retired (AWAI-3049, 2026-11-17)

On the owner's instruction, Home setup no longer shows its own network step ("ネットワークに接続" / "Connect to a network"), because AOSP setup already connects the device. Stage indices stay unchanged. Index 2 is retired: a saved stage 2 resumes at date/time (3); Next from language (1) goes to 3, and Back from 3 goes to 1. The `offline` action and the `network-required` gate were removed. The footer's connection status and stage 7's network summary remain read-only status. Account linking (stage 4) keeps its own "ネットワークを確認" button.

Evidence: shared CLJS rebuilt; `android/tests/*.mjs` 11/11 pass. `home-v13.apk` (sha256 `9e87bd4818bd49dcd1ed1ee3a88eeb9aa2c677334b46beb77ea775d2324555c1`, debug signer `2507930b…`, same as v12) was installed on the 6600H with `install -r`, keeping app data. That device's saved stage 2 opened at 日時を確認; Back gave stage 1 and Next gave stage 3. The updated `SetupInstrumentation` has **not** been run, because it requires a disposable emulator. The Figma setup frames still contain the network screen; per the design-first contract, the Figma flow needs a matching update.

### Language, date/time and screen-lock steps also retired

At the owner's request, Home setup also drops its language (1), date/time (3) and screen-lock (6) steps; AOSP setup owns them. The remaining flow is welcome (0) → account (4) → privacy (5) → ready (7). Saved retired stages resume at the next remaining stage, and Back skips retired stages. The security rule is unchanged: Home only completes when Android reports a screen lock (`isDeviceSecure()`), and the ready page still offers "画面ロックを設定" (opening native Settings) until one exists. The welcome page keeps its language and accessibility shortcuts to native Settings; these are shortcuts, not steps.

Evidence: shared CLJS rebuilt; `android/tests/*.mjs` 11/11 pass. `home-v14.apk` (sha256 `64fe7c95045ccea9c4642f40cb8de2ef1df75d1db91da934b39a5b33d8a85db4`, same debug signer) was installed on the 6600H with `install -r`. That device's saved stage 3 opened at the account step; Back gave stage 0, and はじめる gave stage 4. `SetupInstrumentation` is updated but not run (disposable emulator required). The Figma flow is updated below.

### Figma flow updated

The Figma page "Awai Android · Shared Setup · AWAI-3004" (`umqCqP5KSjLWh9fhCI1HaN`, page `241:2`) now shows the active flow in order: `00 · Welcome` (241:3) → `04 · アカウントと引き継ぎ` (241:170) → `05 · スマートフォン連携` (241:220) → `06 · プライバシー` (241:261) → `08 · 完了` (241:348). Alongside them are the new `08b · 完了 · 画面ロック未設定` (270:300: lock summary "未設定", "Awai をひらく" disabled, primary "画面ロックを設定" button, matching `setup.js`) and `E02 · 連携失敗` (241:442). The retired frames 01 language, 02 network, 03 date/time, 07 device protection and E01 network failure were not deleted. They were renamed "Retired · …" and moved into the section "Retired · AWAI-3049 · AOSP setup owns language, network, date/time and screen lock" (270:349). This is a design-file update, not a visual acceptance of the rendered APK.
