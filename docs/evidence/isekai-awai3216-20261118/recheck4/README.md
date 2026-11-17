# Isekai Fork — fourth Codex review round (AWAI-3216, 2026-11-18)

Record only; do not rewrite. Follows `../recheck3/README.md`.

Review of e6bf20c, three P2 findings:

- **Overlong varints** and **duplicate draft ids** repeat earlier findings that
  e6bf20c already fixes. Both are unit tests (`bahkqaer…` rejected; a repeated id
  makes the stored drafts unreadable) and were checked on the VM in `../recheck3/`.
  No change.
- **Confirm before a permanent delete** (new): Delete is now two-step. The first
  tap changes the button to "Tap again to delete" (red, text changes too) and
  announces that a deleted draft cannot be restored. Only a second tap within 5 s
  deletes; otherwise the button reverts. `window.confirm` was not used because
  JS dialogs in the Tauri Android WebView were not verified.

Final debug APK sha256 `a5d7b5efbee714ad3486faa3db76c3176e9bdbb5804a611d7a3fa41fdcb9276c`
(`apk-sha256.txt`, read back from the device). `npm test` 10/10.

| Check | Result | File |
|---|---|---|
| One tap | Label `Tap again to delete`, status announces it, still 1 stored | `f-delete.js`, `f-delete.json`, `n01-delete-armed.png` |
| Wait 5 s | Label back to `Delete`, still 1 stored | `f-delete.json` |
| Two taps | `Draft deleted.`, 0 stored | `f-delete.json` |
| Cold start after `pm clear`, 64 s idle | COLD, 875 ms; no `mAppUidStatsMap` row for 10148, 99000 or 10109 | `final-launch.txt`, `netstats-appuidstats-*.txt` |

The emulator was stopped right after the run (`emu kill`, 2026-11-17T19:42:56Z).
