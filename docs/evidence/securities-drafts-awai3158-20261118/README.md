# Securities Drafts — first version (AWAI-3158, 2026-11-18)

Source: `apps/securities-drafts` on branch `jun784/awai-3158-securities-drafts`, from the `apps/payment-drafts` template (awai-os#219) with its stored-data protection. Scope: network-awai-apex ADR 0042 D1–D6. Paired bot profile: kotoba-lang/itonami-agent `itonami/profiles/awai-securities-ops` (#5, AWAI-3156), built on kotoba-lang/kotoba `4e7fc2b` (#1354, AWAI-3154).

## Unit tests

`npm test` (Node v26.0.0): 14 tests, 14 pass (4 shared `packages/awai-shell`, 10 app).

| Test | What it pins |
|---|---|
| fixture sources | The five copied profile fixtures have the digests in `test/fixtures/SOURCE.md` |
| same bytes as kotoba.swift | The app builds `sese023-receive-apmt.xml` (sha256 `469900ce…8e904`) exactly from the profile request's fields; both L1 checks pass; importing it gives the same instruction |
| statement | `semt002-statement.xml` imports and rebuilds to the same bytes |
| holdings | The app's lines equal the profile's `reconcile-holdings` expected `:lines` (read from its EDN), from the same positions |
| refusals | ISIN check digit, whitespace or lower case inside values, unknown code, impossible date, a debit/credit indicator that does not follow the direction, an unmodeled element, another version, DOCTYPE; statement with a bad ISIN, a missing `Qty` level, another page |
| field checks | ISIN, quantity and amount digits, currency, BIC, reference length, direction |
| stored state | Instructions and statements together; approve and withdraw; unknown kind or status, invalid or non-normal body, duplicate ids and more than 50 are `unreadable-drafts`; the 51st item is refused |
| messages | ja and en have the same keys; every code, check, result, operation and waits-on text has a label |

## Browser (static build served from 127.0.0.1, Claude desktop browser pane, ja locale, dark theme)

| Check | Result |
|---|---|
| Fill the instruction form with the profile request's values (ISIN typed in lower case) | Preview contains `<ISIN>US0378331005</ISIN>` and `<Amt Ccy="USD">18950.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>`; both L1 checks "合格"; saved |
| Import the statement with one ISIN check digit changed | Refused: "銘柄（ISIN）か数量が正しくない行があります。" |
| Import the profile's semt.002 statement | "取り込みました。" |
| Holdings: positions `US0378331005 100.00`, `JP3633400001 -3`, `DE0007164600 10` | "1 件一致・3 件要確認"; DE…: 報告にない, GB…: 自分の記録にない, JP…: -2.5 / -3 数量が違う, US…: 100 / 100 一致 (`holdings.jpg`) |
| Approve the instruction | "承認しました。何も送っていません。", chip "承認済み・未送信" |
| Delete, two taps | First tap arms ("元に戻せません。…"), second deletes |
| Another window wrote a newer revision, then Save | "別の画面で下書きが変わっていたので、読み直しました。…", nothing written; Save again → saved, the other window's deletion kept |
| A stored item given an unknown kind, reload | Read-only notice; Save and Import disabled; the list does not claim there is nothing; storage byte-identical (`read-only-notice.jpg`) |

## Not run

- The debug APK and the Android VM: host load 43–57 and another session's emulator running. Tracked with Payment Drafts in AWAI-3285.
- A Tauri desktop or APK build in CI: this repository has no such job.
- L2 and L3 (ADR 0042 O3, O5); other people's accounts (O1); any custodian connection (O2).
