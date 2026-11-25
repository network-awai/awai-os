# Trust 計測セル SUMMARY (2026-11-24)

分母は evidence-map.md の全 24 claim（MEASURED 6 / MEASURED-ONCE 14 /
UNVERIFIED 2 / CONTRADICTED 2。`grep -c "^| " docs/research/evidence-map.md` = 26
= header + separator + 24 行。`program-map.md` / `research-plans.md` /
`contributions.md` は同じ claim_id の参照で新 claim を生まない）。
定義は PROTOCOL.md。数値は推測ではなく、BASELINE.tsv の実測。

## 4 項目（分母つき）

1. **claim→証跡 対応率: 24 / 24（100%）**。全 24 claim のパス・PR・ソース行が
   解決する。PR 3 件（#479 / #484 / #485）は全て MERGED で解決確認済み。
2. **証跡 再現率: 16 / 24（67%）**。`reproduced=yes` 16 件、`未再現` 8 件。
   その内訳は次節。
3. **外部依存: 5 種** — github.com / raw.githubusercontent.com /
   release-assets.githubusercontent.com / ota.awai.network / yataverse.com。
   `docs/research/` における **GFTD / MITHRIL の言及は 0 行**
   (`grep -rE 'GFTD|MITHRIL' docs/research/` = 0)。prune 方針の検査としては
   claim 側の違反なし。ADR 内の `ai-gftd-cdn` 等は背景言及で依存ではない。
4. **未検証 claim 数: 2 / 24（8%）** — INSTALL-PC、OTA-ENDTOEND。
   明記されていること自体が健全（後付けで減らさない）。

## 再現できなかったもの（8 件）と理由

- **INSTALL-REVIEW** — PR #479 の head（`0d5c52ac…`）と MERGED / CI pass は
  解決確認したが、引用された suite 件数（Node 119/119、PC Python 24/24、
  guard 30）は本ベースラインでは再実行していない。CI 集約 pass のため根拠は
  あり、件数は未再現。
- **OTA-DESIGN** — PR #484 は MERGED / CI pass で解決したが、test 件数
  （10 / 7 / 24 / 23）は再実行せず未再現。
- **INSTALL-PC / OTA-ENDTOEND** — そもそも UNVERIFIED（物理 qualification が
  未実施）。再現不能は予定通りで、後付けで成功にしない。
- **STORE-PINS / STORE-JOB** — 85 assertions の instrumentation.log 一致は
  確認したが、signed pointer の 2867 B / sha256 prefix の再取得と、エミュレータ
  Job の再実行はしていない（再実行は別途要）。エミュレータ世代再ビルドを
  したい。
- **YATA-RAW / YATA-CAR** — `yataverse put` / `car-put` は未実施（次回再測）。
  YATA-CAR の小さいブロック Range GET（206、`bytes 0-9/55`）は再取得済みだが、
  PUT の 16 MiB / 32 MiB / 10 blocks の数値は未再現。

## 再現できたもの（16 件）の手続き例

- BOOT-LAN / BOOT-PINS / BOOT-INPUT / GPT-REFUSAL: コミット済み JSON を
  `python3 json.load` で引き、bytes / sha256 / sector 等が一致。
- OTA-REF / REF-LIMIT / OTA-PC / OTA-DELTA / OTA-REJECT: KVM 実測 JSON の
  bytes / error / slot / protected-hash が一致（履歴の再実行ではなく記録の読み戻し）。
- OTA-RANGE: read-only Range GET が `206` + `content-range: bytes 0-99/1800000000`
  + `content-length: 100` に一致。
- OTA-ETAG: HEAD `200`、ETag 一致。フル GET の長さ `55456456` B と
  SHA-256 `b1a5f7f7…` を実際に取得して一致。
- OTA-FEED: deployed GET が `200`、`content-length: 2`、`cache-control: no-store`、
  body `[]` に一致。
- STORE-BODY / STORE-DECLARATION: ソース行（`AutoUpdater.java:137/153`、
  `Integrity.java:9`、`UpdatePolicy.java:155`）に記述がある。
- STORE-TEXT / STORE-REFUSAL: 履歴 README の読み戻しに一致。現在の `client.js` に
  問題の文言がないこと（推移の出所は FINDINGS.md F1）を確認。

## 最初に直すべき 1 件

**FINDINGS.md F2（OTA-DESIGN の "signed" の範囲限定）**。OTA の KVM 証跡は全て
AOSP test key・userdebug・KVM であるにもかかわらず、OTA-DESIGN の
「signed, digest-bound ZIPs」は字面だけだと release 署名と読み取れる。
原稿引用では「test-key KVM で署名済み」と範囲を明示しないと
signature 意味論がずれる。OTA-ENDTOEND の UNVERIFIED（物理 signed 適格未実施）と
整合的な限定が先決。
