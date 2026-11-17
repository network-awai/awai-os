# Shared Awai UI adoption — 2026-11-17

JUN-1335. Canonical `packages/awai-ui`0.2 is used by the owning Itonami shell, Murakumo, Drive and Yotei. Existing Figma source: Android v2 Button193:263; Murakumo252:3/252:31 and state variants; Itonami baseline216:476. This change preserves their composition, domain logic, account/consent and storage, and adopts shared native control types, rounded shapes, font/color tokens and focus/disabled styles. Hiru is exported from existing Figma variables168:3/6/10/13/19, not a new theme choice.

The library's non-destructive DOM adapter is for existing apps: no event handler, selected route, input value/type, disabled/hidden flag, identity or permission is replaced. New components may directly use the pure CLJC hiccup API. Canonical consent controls are excluded from decoration; no grant is created. Build-time distribution verifies actual source/artifact hashes and includes local assets/provenance. Source qualification, static build, Android APK and actual launch are distinct observations.

Local verification: shared package7 tests; shell108 tests after adding missing existing Android/WebCrypto externs; Murakumo4 contract checks; Drive/Yotei original tests. Initial sparse omission of bot-fleet test data was corrected by exact materialization, not a test skip. Existing generated Drive core is preserved; UI adoption does not change cryptography. Browser fixture checks at412/1280 exercise all four surfaces and native DOM identity/hidden/disabled. Fixture native status is not an inference or file-storage result. Own Android launch/interaction receipts follow in task evidence.

Unchanged boundaries: no new public service, remote provider fallback, model download, owner-key/profile migration, app-origin API or production OS route cutover. Existing users' device data and services are retained. Dedicated clean Android QA profiles contain only test-created data; physical Awai OS/OTA/TalkBack and actual model-generation acceptance are separate.

## Actual Android launch

PR177 merged to main at43209193d1dc32f92ae2f87ae36629ef5a14d69c. JUN-1336 records the final phone-width/inset delta and runtime receipt. All four final arm64 debug APKs built and launched on a dedicated visible AOSP API35 emulator (720×1604, density280, WebView124). Shared 0.2.0 CSS/JS copied bytes match the canonical package in each consumer. [Machine receipt](evidence/jun-1336/android-launch.json) contains deterministic APK bytes/SHA and actual WebView control states.

| App | Actual launch/interaction | Screen |
| --- | --- | --- |
| Itonami | Sign In; Asa→Hiru token change→Asa. Owner authentication not performed; service connection unavailable is retained. | [Itonami](evidence/jun-1336/itonami.png) |
| Murakumo | No model selected; phone actions occupy separate full-width rows; hidden Stop remains hidden. No import/generation performed. | [Murakumo](evidence/jun-1336/murakumo.png) |
| Drive | Empty device state; Create folder dialog opened/closed without creating files; AwaiFS disconnected. | [Drive](evidence/jun-1336/drive.png) |
| Yotei | Empty device state; Add dialog opened/closed without saving events; system bars remain legible and outside content. | [Yotei](evidence/jun-1336/yotei.png) |

Final probes inspect the actual Android WebView, not the earlier browser fixtures. All visible control styles use the shared 999px radius; operational domain acceptance is limited to the interactions above. UI reuses existing event handlers and preserves legacy agenda backup code. Local tests: package7/shell108/Murakumo4/Drive7/Yotei6 passed; browser fixture412/1280 additionally checks DOM identity/hidden/disabled. These are separate coverage sets, not independent user trials.

Modern Web Guidance `form-factor-adaptation` was applied: “Keep UI clear of notches and system bars”. Touch controls retain minimum52px height; native check/radio labels have48px targets. No CI/native selfhost qualification or production/device cutover is implied. Test-created profile and unique evidence are retained; existing user devices and services were not stopped.
