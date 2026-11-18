# x402 Pay — Isekai review fixes ported (AWAI-3284, 2026-11-18)

Source: `apps/x402` on branch `jun784/awai-3284-x402-pay-isekai`, ported from the Isekai Fork review fixes (awai-os#217, commits 84e292f, 732c045, e6bf20c, f94124a). The CID / did:key decoding fixes do not apply (x402 has no such fields).

## Unit tests

`npm test` in `apps/x402`: 10 tests, 10 pass. New assertions: 50 drafts decode; 51 drafts and duplicate ids are `unreadable-drafts`; `drafts.full` exists in ja/en; the English draft count is `1 saved`.

## Browser (static build served from 127.0.0.1, Claude desktop browser pane, ja locale)

| Check | Result |
|---|---|
| Save a draft | "下書きを保存しました。", revision 1, 1 draft |
| Delete, first tap | Button shows "もう一度押すと削除" (class `armed`), status warns; stored drafts unchanged (1) |
| Delete, second tap | "下書きを削除しました。", 0 drafts |
| Another window wrote a newer revision, then Save | "別の画面で下書きが変わっていたので、読み直しました。…", form values kept, nothing written; Save again → saved |
| In-memory 50 drafts, another window reduced to 1, then Save | Re-read and conflict message (not the limit message); Save again → saved (2 drafts) |
| 50 stored drafts, Save | "下書きは 50 件までです。…", nothing written |
| 51 stored drafts, reload | Read-only notice at start; Save button disabled; Enter submit → "保存した下書きを読めないため…"; notice stays on Drafts, Operations and back; storage byte-identical |

`read-only-notice.jpg` is the draft view in the read-only state (dark theme).

## Not run

The Android VM was not used: host load was 46–62 (rule: below 40). The `MainActivity.kt` system-bar change and the manifest `configChanges` change are the code already checked on the API 35 VM for Isekai (docs/evidence/isekai-awai3216-20261118/recheck*), but they are not re-checked for x402.
