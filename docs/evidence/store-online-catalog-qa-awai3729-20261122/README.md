# Store: online catalog admission and App QA findings (AWAI-3729)

Date: 2026-11-22. Findings from App QA (AVD AppQA_Store_AWAI3729_API35, main `f3d8d70f`). Checked here on AVD `Awai_Store_AWAI3653_API33` (API 33, WebView 101). The host was heavily loaded (load average about 135), and the first runs hit system ANR dialogs; the emulator was restarted and error dialogs were hidden (`settings put global hide_error_dialogs 1`).

Build: `python3 android/build.py --version 1 --skip-cljs --store-only --online-pins android/online-pins.dev.json --out .agent-output/qa-store-only` into a new, empty output directory. rc=0. store-v1 SHA-256 `1e511fd0…`. Tracked `android/client/generated/` files were not modified.

| Finding | Before | After |
|---|---|---|
| Allow on the online catalog check | 「端末でカタログを検証できません。」: the host accepted only a one-app (Yotei) catalog while the pins require all 8 apps of r109 | 「署名済みオンラインカタログを確認しました。」; 8 apps listed as オンライン配信, `highest` 109 (`qa-allow.png`) |
| Refusal reason | swallowed; nothing in logcat | `admitOnlineCatalog` returns `refused:<code>`, logs `W AwaiStore: online catalog refused: <code>`, and the page shows the reason in Japanese. Checked: changed bytes → `catalog-signature`, same revision again → `catalog-rollback`, empty → `catalog-signature` |
| Deny | 「取得を完了できません。client operation was not approved」 | 「取得を完了できません。許可しなかったため、何も送信していません。」 (`qa-deny.png`) |
| `--store-only` on a clean output directory | failed (needed an earlier full build's Yotei APK; needed `npm ci`) | builds Yotei when it is missing; a missing esbuild stops with 「run `npm ci` in otehon/shell」 |
| Build rewrites tracked `android/client/generated/{identity,wnfs-account}.js` and creates `account-broker.js` (AWAI-3772) | yes | no: `build-identity.mjs` writes to the build directory given by `build.py` |
| Consent dialog in English | — | **not changed**: the dialog text comes from the pinned canonical runtime (`otehon/shell/vendor/kotoba-client-runtime.js`, `createClientConsentHost`), which has no locale option. Product-local consent copies are not allowed, so this needs a change in kotoba-lang/kotoba |

Also: an online catalog that lists an offline-only preview app is now refused at admission (`preview-offline-only`) instead of breaking the Store when the catalog is next loaded; the same check runs in the daily automatic update.

Not changed here: the bottom tab bar scrolling with the content on 見つける (App QA note).
