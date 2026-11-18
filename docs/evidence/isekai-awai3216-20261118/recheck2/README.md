# Isekai Fork — second Codex review round (AWAI-3216, 2026-11-18)

Record only; do not rewrite. Follows `../recheck/README.md`.

Second review on PR #217 (commit 84e292f), five P2 findings, all addressed:

1. Stored state with more than 50 drafts was truncated in memory, so a later write
   would drop the hidden drafts. It is now unreadable, so the app goes read-only.
2. secp256k1 / P-256 keys of the right length were accepted without checking the
   point. Points are now validated on the curve: SEC1 compressed prefix, x < p and
   y² a square. Ed25519 points are checked the same way (y < p, x² a square).
3. Overlong varints (such as `d5 00` for raw) were accepted. Only the shortest
   encoding is now accepted.
4. A live locale change did not re-render. See below.
5. `did:key` input had no length limit before BigInt base58 decoding. The base58
   part is now limited to 40–60 characters.

Unit tests: `npm test` 10/10, with the review's counterexamples as cases
(`bahkqaer…` overlong codec, `did:key:zQ3sgkx…` zero secp256k1 point, a 100,000
character paste, 51 stored drafts, an ed25519 key with y ≥ p).

Device: same AVD `Awai_Isekai_AWAI3216` (`build.txt`), final debug APK sha256
`908e1ed63920561022b8c333cf9e7d2c99be9a3f9f7c36147bf6d096b18990fe`
(`apk-sha256.txt`, read back from the device). `MainActivity.kt` is unchanged
since `../recheck/`, so the system-bar results there still apply.

## Storage behaviour on the final APK (same scripts as `../recheck/`)

| Check | Result | File |
|---|---|---|
| Revision conflict | Re-read message, next save succeeds, `third, first` stored | `a-conflict.json` |
| 50 drafts, then Save | Limit message, 50 stored | `b-full.json` |
| Unreadable schema | Read-only, notice kept on every view, storage unchanged | `c-unreadable.json` |
| 51 valid drafts stored | Read-only notice, no Delete buttons, 51 still stored | `d-over.js`, `d-check.js`, `d-over-limit.json` |

## Locale change while running

`app.js` now handles `languagechange` and re-renders with the new translator,
keeping the form values. Tested on a page that is not reloaded, both through a
route change and with a dispatched `languagechange`: the values were kept.

On Android this path is not reached. `cmd locale set-app-locales` relaunched the
activity (`WindowManager: finishDrawing of relaunch`) and the page reloaded (page
age 3 s afterwards), so the UI came up in the new language (`l01-en-typed.png` →
`l02-ja-live.png`). **Open:** unsaved form input is lost on that reload. Saved drafts
are not affected. The handler covers runtimes that change the language without a
reload (desktop WebView, browser).

## Network

Cold start (`final-launch.txt`: COLD, 1114 ms) after `pm clear`, 60 s idle: no
`mAppUidStatsMap` row for 10148, 99000 or 10109.

The emulator was stopped right after the run (`emu kill`, 2026-11-17T19:22:47Z).
