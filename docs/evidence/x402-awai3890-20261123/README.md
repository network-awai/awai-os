# x402 AWAI-3890 — isekai same-type defects: reproduction verdicts

Date: 2026-11-23 · Branch: `com-junkawasaki/awai-3890-x402` · Worker session `077413dc`

## Method

The isekai fix (awai-os#217 / `2eee57a` / AWAI-3216) was already ported to x402 in
AWAI-3284 (#218) and AWAI-3309 (#224), so AWAI-3890 was treated as a verify-first
task: reproduction tests were written FIRST in `apps/x402/test/repro-3890.test.mjs`
(7 tests) and run against the unmodified code, then only the reproduced defect
was fixed. Apps/isekai was read as the reference only; no isekai file was touched
(`git status` shows changes only under `apps/x402/`).

## Per-item verdicts

| # | Defect class | Verdict | Evidence |
| --- | --- | --- | --- |
| (a) | Stored-data overwrite | **Not reproduced** as data loss (host + model fail closed: corrupt envelope read/write rejected, stored bytes preserved; unreadable drafts throw instead of truncating). **Reproduced** in one app-level sub-path: when `host.read()` itself threw (corrupt/unreadable storage envelope), `load()` in `src/app.js` never set `readOnly`, so save/delete stayed enabled over unknown stored state (and the drafts view could claim "No drafts yet"). | Repro test `(a) corrupt storage envelope also goes read-only instead of overwriting` FAILED on current code (`saveDisabled` false ≠ true); the decode-failure and host-level overwrite tests passed. |
| (b) | Silently-failed limits | **Not reproduced.** Every limit returns a specific code: `amount.max/format/zero/empty`, `payTo.format`, `description.long`, `too-many-drafts` (thrown, reported as `drafts.full`). | Repro test `(b) every limit violation returns a specific error code` passed. |
| (c) | Hidden startup errors | **Not reproduced.** Startup failures set a persistent `notice` rendered by `route()` on every view; all four notice keys have ja+en labels. Boot harness over corrupt storage shows a non-empty status line (no blank page). | Repro tests `(c)` and `(a/c)` passed, including before the fix. |
| (d) | System bar colour | **Not reproduced.** `MainActivity.kt` sets the decor colour from `uiMode` (`#FFFFFF` / `#14110F` = `style.css` `--bg`), both light-appearance flags, `onConfigurationChanged`, and disables nav contrast enforcement; manifest `configChanges` includes `uiMode` and excludes `locale`. | Repro test `(d)` passed. |

## Fix (one path, x402 only)

`apps/x402/src/app.js` `load()`: the `await host.read()` call moved inside the
try, so a read failure sets `readOnly = true` exactly like a decode failure.
Subsequent writes then say `state.readOnly`; the reload in the conflict path now
also reports `state.unreadable` instead of `state.failed`. No overwrite was
possible before either (the host re-reads under lock and fails closed), but
controls over unknown state were enabled — now they are off, matching the
decode-failure policy and AWAI-3309's intent.

Note: `apps/isekai/src/app.js` has the identical read-failure gap. It was left
untouched per this task's constraint (isekai is reference-only); filing the same
one-line fix there is a separate decision.

## Test counts

- Before: `npm test` 10 tests, 10 pass · `npm run build` 20 pinned files, green.
- Repro run (pre-fix): 7 new tests, 6 pass / 1 fail (the corrupt-envelope test above).
- After: `npm test` 17 tests, 17 pass · `npm run build` 20 pinned files, green.

## Device / emulator check

**Deferred to a separate slot.** Host state at run time: free disk 3.2 GiB
(≤ the ~3.5 GiB limit in the task), no `adb` on PATH, and no qemu/emulator
processes running (only unrelated Claude app renderer processes matched a text
search). Existing AVDs were not touched; no new AVD was created; nothing was
sent to 10.77.0.2:5555 or any other session's device.

## Files

- `apps/x402/test/repro-3890.test.mjs` (new)
- `apps/x402/src/app.js` (`load()` only)
- This evidence directory
