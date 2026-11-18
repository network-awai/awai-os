# Isekai Fork — re-check after the Codex review fixes (AWAI-3216, 2026-11-18)

Record only; do not rewrite. Follows `../README.md` (first run).

The review on PR #217 raised six findings. All six were fixed in the app before
merge:

1. stored drafts that fail validation made the app writable over them (P1);
2. a revision conflict left the view stale;
3. the 50-draft limit failed silently;
4. startup errors were cleared by the first route;
5. CIDs and did:keys were only matched against their alphabet;
6. system-bar icon colours ignored the theme.

Same AVD `Awai_Isekai_AWAI3216` (not wiped this time; `build.txt`: API 35
`sdk_phone64_arm64`). App data was cleared with `pm clear` before each run. Final debug APK
sha256 `4e9026d2465aad0da5e9ec7df223db0f20259896e04ec66567f26e4b20508876`
(`apk-sha256.txt`); the installed copy pulled from the device has the same hash.
The final APK differs from the one used for checks 1–3 only in `MainActivity.kt`;
the WebView files (`dist/`) are the same build.

## 1–3. Storage behaviour, driven through the WebView DevTools protocol

The debug WebView's DevTools socket was forwarded with `adb forward` and driven
with `cdp.mjs` (Runtime.evaluate). The scripts are the `*.js` files here. They
set form values and submit the real form, or write the host's localStorage
envelope directly to simulate another window or an old format.

| Check | Result | File |
|---|---|---|
| Revision conflict (stored revision bumped between loads) | `The drafts changed in another window and were read again. Try once more.`; the next save succeeds. The stored list is `third, first`: the conflicting save was not written, and nothing was lost | `a-conflict.json` |
| 50 drafts stored, then Save | `You can keep up to 50 drafts. Delete one before saving.`; still 50 stored | `b-full.json`, `r02-full.png` |
| Stored drafts in an unreadable schema | Startup notice shown; Save disabled; a forced submit says saving is off; the notice stays on the Drafts view; storage byte-identical afterwards | `c-unreadable.json`, `r03-unreadable.png` |

## 4. CID and did:key decoding

Unit tests (`npm test`, 10/10). CIDv1 accepted: raw and dag-cbor. did:key
accepted: ed25519, secp256k1 and P-256 (did:key spec vectors). Rejected: an
alphabet-shaped `b` + 50 `a`, a truncated or extended digest, CIDv0, and
`did:key:z` + 40 `1`.

## 5. System bars (3-button navigation)

Pixel samples (status-bar background, navigation-bar background, home-button icon):

| Screen | Status bar | Nav bar | Icon |
|---|---|---|---|
| Light, cold start (`r05-light-cold.png`) | 255,255,255 | 255,255,255 | 69,70,79 (dark) |
| Switched to dark while running (`r04-dark-live.png`) | 20,17,15 | 20,17,15 | 197,198,208 (light) |
| Dark, cold start (`r06-dark-cold.png`) | 20,17,15 | 20,17,15 | 197,198,208 (light) |
| Switched back to light while running (`r07-light-live.png`) | 255,255,255 | 255,255,255 | 69,70,79 (dark) |

The first attempt (icon colours only) gave light icons on a light bar after a live
switch. A theme switch does not recreate the activity (`uiMode` is in
`configChanges`), and the 3-button scrim is chosen at start. The fix sets the decor
colour to the page's `--bg` and turns off the enforced navigation-bar contrast.

## 6. Network

Final APK, cold start (`final-launch.txt`: COLD, 1141 ms), 60 s idle:
no `mAppUidStatsMap` row for the app (10148), its renderer (99000) or the WebView
service (10109) (`netstats-appuidstats-*.txt`). The app requested a variations
seed again after `pm clear`, but the WebView service already had one from the
first run and did not fetch. This is consistent with the first run's 10109
traffic being a once-per-device WebView seed fetch.

The emulator was stopped right after the run (`emu kill`, 2026-11-17T19:08:43Z).
