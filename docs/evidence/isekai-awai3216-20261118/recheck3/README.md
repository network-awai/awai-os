# Isekai Fork — third Codex review round (AWAI-3216, 2026-11-18)

Record only; do not rewrite. Follows `../recheck2/README.md`.

Third review on PR #217 (commit 732c045), four P2 findings:

1. **Overlong varints**: this repeats the second round's finding. The stated
   counterexample `bahkqaer…` was already rejected at 732c045, and it is a unit
   test. No change.
2. **Locale change**: `locale` is removed from the activity's `configChanges`, so
   Android always recreates the activity on a locale change and the page reloads
   in the new language. The `languagechange` handler stays for runtimes that do
   not reload.
3. **Duplicate draft ids**: stored state with a repeated id is unreadable
   (read-only), because deleting by id would remove every entry with that id.
4. **Low-order Ed25519 keys**: an Ed25519 key must now fully decompress, must
   not be the identity, and must satisfy L·P = identity (prime-order subgroup).
   Unit tests reject the identity point from the review and two known small-order
   encodings. The did:key spec ed25519 vector is still accepted.

`npm test`: 10/10. Final debug APK sha256
`e7235b4eae663afab37513761f5f4725195af00034726b6e8c9b5737426ba4a1`
(`apk-sha256.txt`, read back from the device). AVD `Awai_Isekai_AWAI3216` (`build.txt`).

## Device checks on the final APK

| Check | Result | File |
|---|---|---|
| Per-app locale en → ja → en while running | UI follows each change; same process, no crash in logcat | `m01-en.png`, `m02-ja-live.png`, `m03-en-live.png` |
| Theme switched to dark while running | Status bar 20,17,15, nav bar 20,17,15, icons light (197,198,208) | `m04-dark-live.png` |
| Revision conflict | Re-read message, next save succeeds | `a-conflict.json` |
| 50 drafts, then Save | Limit message, 50 stored | `b-full.json` |
| Unreadable schema | Read-only, storage unchanged | `c-unreadable.json` |
| 51 valid drafts | Read-only, no Delete buttons, 51 stored | `d-over-limit.json` |
| Two drafts with the same id | Read-only, no Delete buttons, 2 stored | `e-dup.js`, `e-duplicate-ids.json` |
| Cold start after `pm clear`, 64 s idle | COLD, 972 ms; no `mAppUidStatsMap` row for 10148, 99000 or 10109 | `final-launch.txt`, `netstats-appuidstats-*.txt` |

Unsaved form input is still lost when Android reloads the page on a locale change
(open, as in `../recheck2/`).

The emulator was stopped right after the run (`emu kill`, 2026-11-17T19:33:55Z).
