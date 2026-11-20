# Payment Drafts — first version (AWAI-3157, 2026-11-18)

Source: `apps/payment-drafts` on branch `jun784/awai-3157-payment-drafts`, from the `apps/x402` template after the Isekai/x402 review fixes (awai-os#217, #218), including their stored-data protection. Scope: network-awai-apex ADR 0042 D1–D6. Paired bot profile: kotoba-lang/itonami-agent `itonami/profiles/awai-banking-ops` (#4, AWAI-3155).

## Unit tests

`npm test` in `apps/payment-drafts` (Node v26.0.0): 12 tests, 12 pass (4 shared `packages/awai-shell`, 8 app).

| Test | What it pins |
|---|---|
| fixture source | `test/fixtures/pain001-eur-single.xml` is sha256 `2b40693c…7b5a8b`, the awai-banking-ops fixture built by kotoba.swift at `2e3b9ef` and validated against the pinned XSD |
| same bytes as kotoba.swift | The app builds that exact file from the same fields; both L1 checks pass |
| import | The fixture, compact or pretty-printed, imports to the same instruction |
| import refusals | Whitespace inside a value (AWAI-3153 K1), `ReqdExctnDt` as text (K2), impossible date, uppercase or non-v4 UETR, bad IBAN check digits, mismatched `CtrlSum`, an unmodeled element (`Purp`), another version, DOCTYPE, truncated XML, unknown entity, oversize input |
| field checks | BIC, IBAN pattern and MOD 97-10, lengths, charge codes, amount digits per currency (2, or 0 for JPY/KRW), calendar dates and date-times |
| stored state | Approve and withdraw; unknown status, `approved` without a time, invalid or non-normal instruction, duplicate ids and more than 50 drafts are `unreadable-drafts` (never truncated or repaired); the 51st draft is refused |
| messages | ja and en have the same keys; every problem code, check, operation and waits-on text has a label |

## XSD (L1) of app-built variants

Validated with `xmllint --schema` against the digest-pinned `pain.001.001.09.xsd` (kotoba-lang/kotoba `lib/kotoba.swift/conformance/xsd-pins.edn`): JPY with 0 decimals, 8-letter BIC, leap day, instruction reference and an escaped name; EUR 0.01 with a one-letter payee name; USD with UETR and a 140-character purpose. All three `validates`. The fixture itself was validated in AWAI-3155.

## Browser (static build served from 127.0.0.1, Claude desktop browser pane, ja locale, dark theme)

| Check | Result |
|---|---|
| Fill the form with the fixture values (IBAN typed with spaces) | No field errors; preview shows the XML; both L1 checks "合格" |
| Save | Draft stored (`source: form`) |
| Import the profile fixture with a padded `MsgId` | Refused: "値の前後の空白や大文字・小文字が、この app の作る形と違います。" |
| Import the fixture | "取り込みました。" (`source: import`) |
| Approve | "承認しました。まだ送信していません。", chip "承認済み・未送信", `approvedAt` stored |
| Delete, first tap | Button "もう一度押すと削除" (`armed`), warning shown, still 2 drafts |
| Delete, second tap | "下書きを削除しました。", 1 draft |
| Stored draft given an unknown status, reload | Read-only notice; Save and Import disabled; notice stays across views; the drafts list does not claim "no drafts"; storage byte-identical |
| Restore the stored status, reload | Draft listed again (`drafts-approved.jpg`) |
| Another window wrote a newer revision, then Save | "別の画面で下書きが変わっていたので、読み直しました。…", nothing written, form kept; Save again → saved, the other window's change kept |
| A `fetch` from the page | Blocked by the page CSP (`connect-src ipc: http://ipc.localhost`) |
| External operations view | Three operations, all "無効", each with what it waits on (`external-operations.jpg`) |

Screenshots: `read-only-notice.jpg` (unreadable stored drafts), `drafts-approved.jpg`, `external-operations.jpg`.

Fixed during the walk-through: the drafts list said "下書きはまだありません。" in the read-only state, and the waits-on text of one operation was English in the ja UI.

## Not run

- The debug APK build and the Android VM: host load was 41–76 during this unit (rule: below 40). `MainActivity.kt` and the manifest are the x402 ones with the package renamed; the manifest has no `INTERNET` permission.
- A Tauri desktop or APK build in CI: this repository has no CI job that builds the Tauri apps (also true for x402 and Isekai).
- L2 and L3 (ADR 0042 O3, O5); other people's transactions (O1); any bank connection (O2).
