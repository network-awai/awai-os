# horei: language switch re-renders the app — 2026-11-18

Tracking: [AWAI-3437](https://linear.app/kotobalabs/issue/AWAI-3437) (same
approach as x402 AWAI-3284; parent AWAI-3393).

## Change

- `AndroidManifest.xml`: `locale` removed from `configChanges`, so Android
  recreates the activity on a language change and the page loads in the new
  language.
- `src/app.js`: `locale`, `t`, `num` and `plural` are `let`; a `languagechange`
  handler rebuilds them and redraws the header, environment line and current
  route, for runtimes that change language without a reload.

## Checks

| Check | Result |
| -- | -- |
| `npm test` | 24/24 pass |
| Browser (local static server), `languagechange` with `navigator.languages` set to `ja-JP` then `en-US` | Title, nav, labels, chips, result count and environment line switch language; the search text `民法` and its 11 results stay |
| Android VM | Disposable AVD, Android 15 `AE3A.240806.019` (`sdk_phone64_arm64`), deleted afterwards. Clean debug APK 22,763,488 bytes, sha256 `fb58913d346c4da034e670e95fbb78e383f79e5fbff19000c8709d79c3b72a57`, LOAD `Align 0x4000`, `zipalign -c -P 16` OK |
| `cmd locale set-app-locales … en-US` | English UI (`en.png`) |
| then `ja-JP` while running | Japanese UI (`ja-after-switch.png`) |
| then `en-US` again | Pixel-identical to the first English screen (sha256 `89907b91…bf3e`) |

No `FATAL EXCEPTION` in logcat. Not checked: a physical device, and changing the
system-wide language in Settings (the per-app locale command was used).
