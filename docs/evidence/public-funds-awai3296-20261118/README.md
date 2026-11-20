# Public Funds — first version (AWAI-3296, 2026-11-18)

Source: `apps/public-funds` on branch `jun784/awai-3296-public-funds-app`, from main `39aac64`, using the `apps/securities-drafts` layout and its stored-data protection. Scope: network-awai-apex ADR 0046 (D3, D7, D8). Paired bot profile: kotoba-lang/itonami-agent `itonami/profiles/awai-public-funds` (#6, AWAI-3294, merge `f286693`).

## Design

Figma, file "Awai Android Native UX v2", new page **Public Funds · Awai UI · AWAI-3296** (`305:1832`), built from the file's Android v2 components (App nav item, Button) and its semantic variables (`android/*`, `shape/large`), with two local components (`Public Funds / Metric`, `Public Funds / Ministry row`):

| Screen | Node |
|---|---|
| 流れ · 支出済 | [`307:13`](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=307-13) |
| 予算と決算 (with the fiscal-year card `308:133`) | [`307:126`](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=307-126) |
| 出典と前提 | [`307:216`](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=307-216) |
| 取り込む · 状態 (empty, imported, error, read-only, external operations) | [`307:298`](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=307-298) |

The proposal's numbers are the FY2024 values of the bot result. Differences between the proposal and the implementation, found in the browser check and kept on purpose:

- The flow chart names only divisions tall enough to label; the smaller ones (03, 06, 07, 08) are listed under the chart. The proposal drew five divisions and did not have this case.
- Bands are stacked in the order of the opposite column so they do not cross inside a node.
- The two metric cards "翌年度繰越・不用" and the coverage line are as designed; the "低い確度の区分を見る" button became the codes list, because the record carries the unmapped and unknown codes but not each code's confidence.
- The read-only notice is a card at the top of the import view, as designed, in addition to the status line.

No owner design decision was needed: the app adds no navigation to the Awai shell, and uses the Android v2 components and tokens.

## Unit tests

`npm test` (Node v26.0.0): 13 tests, 13 pass (4 shared `packages/awai-shell`, 9 app).

| Test | What it pins |
|---|---|
| fixture sources | The two copied profile fixtures have the digests in `test/fixtures/SOURCE.md` |
| bot result | `jp-fy2024-general.result.edn` imports: 66 rows, the seven totals, both identity checks (6,962 rows, match), the four ministries without a DID, two sources with their sha256, mapping version |
| sums | Per ministry and per division sums equal the record totals; 厚生労働省's initial, spent and difference |
| flows | Grouping keeps every yen for both measures; eight ministries plus one group |
| layout | Proportional heights, opposite-column order, nothing outside the chart |
| refusals | The bot's refusal; one yen added to a total; one yen added to one row; another record kind; an unverified or non-https source; tagged, float, string-keyed, duplicate-key, too large, too deep and unclosed EDN |
| EDN reader | Strings with escapes, negative integers, nil, keywords with a namespace; trailing data refused |
| stored state | Add, replace by key, the limit of four, series by year, removal; unreadable shapes refused; four results fit the host's 128 KiB state limit |
| messages | ja and en have the same keys; every operation and COFOG division has a label |

## Static build

`npm run build`: 20 pinned files in `dist/release.json` (`externalOperations: 0`, `records: ["awai.public-funds/1"]`); the canonical runtime pin check passed.

## Browser (static build served from 127.0.0.1, Claude desktop browser pane, 375 × 812, ja locale, dark theme)

| Check | Result |
|---|---|
| Paste the bot's refusal and check | "取り込めませんでした / bot が断った記録（refusal）です。結果ではありません。/ 保存した結果は変えていません。" |
| Paste the bot result and import | "取り込みました。"; the list shows jp-fy2024-general, 2024年度, 66 行, 出典 2 件 |
| Flow, spent | Eight ministries and その他の所管 to 01, 02, 04, 09, 10 and 対応なし; small divisions listed: 03 1.73, 06 0.31, 07 1.20, 08 0.20 兆円; 対応なし 8.00 兆円 (`flow.jpg`) |
| Budget and outturn | 112.57 / 126.51 / 123.02 / 14.55 兆円; both checks "6,962 行一致"; 18 ministries, 0 only in one file; one fiscal year; 厚生労働省 −1.72, 総務省 +4.30, 経済産業省 +5.55 兆円 (`budget.jpg`) |
| Sources | Both MOF sources with "sha256 確認済み", fetch date, details with URL, full and archive digests and PDL1.0 (`sources.jpg`) |
| A stored result given an invalid import time, reload | Read-only card and status; file picker and import disabled; restoring the stored bytes brings the result back (`read-only-notice.jpg`) |
| Network | The resource timing list has no request outside the page origin; no console errors |

The fixture was put into the textarea through a temporary module in `dist/` (removed afterwards), because the browser pane has no file picker automation; the file picker itself was not exercised.

## Tauri desktop build

`CARGO_BUILD_JOBS=4 nice -n 10 npx tauri build --no-bundle` on macOS (arm64, rustc 1.99.1, Tauri CLI 3.0.0-alpha.6, host load average about 300): `Finished release profile in 8m 50s`; binary `src-tauri/target/release/public-funds`, 12,303,488 bytes, sha256 `cc94c13376bef9afd6ea8c7520e24850b3e22fc8a6d900c850b100f51ad3c2fc`. The binary was built, not launched; the WebView content is the static build checked above. `src-tauri/gen/android` is not generated here; the Android project and APK are AWAI-3297.

## Not run

- The APK on the API 35 VM and on a device running Awai OS: [AWAI-3297](https://linear.app/kotobalabs/issue/AWAI-3297).
- English locale and tablet width in the browser (the message tables have the same keys; layout widths are not fixed to Japanese text).
- Fetching from a publisher (ADR 0046 O1), publication (O2), and receiving from the bot.
