# GFTD 名前空間（`ai-gftd*`）棚卸し — 18 repo / 690 files / 5001 rows

- 日付: 2026-11-24（オーナー指示 2026-11-24: 「GFTD 名前空間（ai-gftd-cdn）関係は全体から prune」。**この回は調査と分類のみ。コード・設定を変更していない。** bucket を触らず、データを移さなかった）
- 成果物: `INVENTORY.tsv`（同ディレクトリ、このファイルと併せて2ファイルのみ新規追加） + 本 `SUMMARY.md`
- 対象文字列: `ai-gftd`（`ai-gftd-` プレフィックス）を含む tracked ファイル。`*.gftd.ai` のみで `ai-gftd` を含まない参照（例: `blobs/mng4k4x1.gftd.ai/<key>` のみの行）は**スコープ外**（§10 参照）

## 0. 結論（件数と repo 別内訳）

| 種別 | 行数 | ファイル数 | prune 方法 |
|---|---:|---:|---|
| LIVE-BINDING | 8 | 4 | binding 削除 |
| LIVE-CODE（fetch） | 11 | — | fetch 先を yataverse / commit-pin raw に置換 |
| LIVE-CODE（ops: dispatch namespace） | 2 | — | dispatch namespace 置換（要設計） |
| HISTORY | 4866 | 626 | 記述を中立化（297 行）/ 触らない（証跡保持）4,569 行 — §5 |
| UNRELATED | 4 | 2 | 触らない（UNRELATED） |
| 未確認 | 110 | 67 | 未確認（binary 7 + コード 103）— §7 |
| **合計** | **5001 行（文字列出現 7038 件）** | **690 files** | |

**prune 判断の要点（実測）**:
- **LIVE-BINDING は 8 行だけ**（4 ファイル）。本番トラフィックが GFTD バケット/DB に直結している行は、そのうち D1 宣言と R2 宣言が中心で、**fetch 側（LIVE-CODE: fetch 11 行）は別ファイルに分散**している。binding 行と fetch 行は同じ行に現れないため、TSV だけでは結び付かない点に注意（§3・§4）。
- **HISTORY 4,866 行**のうち **4,569 行（94%）は「消すと証跡が壊れる」** 証跡保持（ADR・移行インベントリ・fleet 台帳・障害記録等）。中立化してよいのは **297 行**（README・RUNBOOK・コードコメント等の現行文書）のみ。
- **未確認 110 行**は、binary 7（再ビルド元不明）とコードの識別子/絶対パス/テストデータ 103（rename 設計が要る）。勝手に消すとビルド/テストが壊れる層。

## 1. 測定方法（再現手順）

- 母集団: `~/github/repos` 配下 58 ディレクトリの列挙（4 org）:
  - `cloud-itonami/*` 25、`kotoba-lang/*` 10、`network-awai/*` 22、`com-junkawasaki/*` 1 = **58**
  - うち **2 件は symlink**（`kotoba-lang/jp-go-digital-design-system -> kotoba/lib/kotoba.jpGoDigitalDesignSystem`、`kotoba-lang/text -> kotoba/lib/kotoba.text`）で独立 checkout ではないため除外。実 checkout ディレクトリ **56**（うち `network-awai/awai-os-wt-dandori` は `network-awai/awai-os` の linked worktree。別 branch/HEAD のため別行として計上）
- 検索コマンド（各 checkout の HEAD 上の tracked ファイル）:
  ```sh
  git -C <repo> grep -n "ai-gftd"
  ```
  - binary ヒットは `Binary file ... matches` として行番号なし（`line=0`）で計上
  - **untracked/ignored ファイルは対象外**（未確認。`git status` の untracked 棚卸しはこの回未実施）
- 行数定義: 1 行 = 1 出現行（`git grep -n` の行）。1 行に `ai-gftd` が複数回出る場合（巨大な単一行 EDN/JSON）が在るため、**文字列出現件数は行数より多い**（7038 件 vs 5001 行）。最大行長は約 370 万文字（`com-junkawasaki/root` の concept datoms 1 行）。TSV の文字列列は **500 文字で切り詰め**（`…(truncated, total N chars)`）。切り詰めた行の全文は各 repo の HEAD で再取得できる。
- HEAD（測定時点、18 repo）:
- cloud-itonami/app-itonami-animeka — `ec086afd4dbd945074dad75974bbe990022e2f8a`
- cloud-itonami/app-itonami-cloud-itonami-isco-2641 — `aad0cb00e6cd7685c58b180aba08ae56eca8667a`
- cloud-itonami/app-itonami-dougaka — `c29b87e59fdb1b8b65e18a2ca7295356cd0af1e9`
- cloud-itonami/app-itonami-isekai — `791e4c47e6ebd8f25f6595282d82eef053307694`
- cloud-itonami/app-itonami-mangaka — `be14ba02604f6759c6fe1296fb938aba2d5ecb65`
- cloud-itonami/app-itonami-shinshi — `ecc4bf070f5bca7b941eb6136eead6f70ad0628f`
- cloud-itonami/cloud-itonami-app — `8283cfb1f10dfec0bc486b4290238aa6f8732330`
- com-junkawasaki/root — `4f23033b63008df4cc722968fda6624c87353c91`
- kotoba-lang/kotoba — `d42d092203eac885f4fccce8ce4b0fb97e49b400`
- kotoba-lang/kotoba-lang — `b4837af404a988eeea0ad847d9b27aa065f46a37`
- kotoba-lang/torihiki — `263104338a9c262c86b6842ddbb3b0dca26d1650`
- network-awai/app-itonami-adserver — `51f201526690e91cf3f6f7e742df3a0cfc688aef`
- network-awai/awai-os — `d95428340f0f20502e3d73f0ead3afb888254f8d`
- network-awai/awai-os-wt-dandori — `3cde2171ee4f873e07b709534ccd96318c5fbbe9`
- network-awai/cloud-itonami — `044aaea5f7496b0a900a8bb98efe432ea300ffb7`
- network-awai/cloud-murakumo — `fe3b3b2f5607c5af680b7d8521fe233ac81c2561`
- network-awai/network-awai-apex — `d6a68cad4a6d8c06ff928ccbdddd39ddafd0543e`
- network-awai/network-isekai — `469be874b1aaacbd634581ba0ec9ca5e002a957f`

## 2. 前提（200 ファイル / 17 repo）との差分

タスクに記載の前提（200 ファイル / 17 repo、および repo 別内訳）と、本実測（690 files / 5001 rows / 18 repos）は**一致しない**。再現できなかったため、本実測を正とする。

| repo | 前提ファイル数 | 実測ファイル数 | 実測行数 | 差の主因（実測で確認した範囲） |
|---|---:|---:|---:|---|
| com-junkawasaki/root | 52 | 434 | 4,376 | 90-docs/migration の生成済みインベントリ JSON 5 ファイルだけで 2,600 行超（例: preclassification.json 1,434 行）。前提の 52 では再現できない |
| kotoba-lang/kotoba | 50 | 60 | 257 | `lib/kotoba.kamiWeb/demos/haisen.json` の生成カタログ 168 行を含む |
| network-awai/cloud-itonami | 20 | 25 | 86 | — |
| cloud-itonami/app-itonami-mangaka | 19 | 68 | 110 | `comfy/` 配下の絶対パス直書きスクリプト 43 ファイル超が大半。comfy を除けば 25 ファイルに近づく |
| network-awai/network-isekai | 14 | 20 | 21 | wasm binary 2 ファイルを含む |
| network-awai/cloud-murakumo | 14 | 19 | 37 | — |
| cloud-itonami/app-itonami-isekai | 8 | 8 | 9 | 一致 |
| cloud-itonami/app-itonami-shinshi | 7 | 15 | 29 | — |
| cloud-itonami/cloud-itonami-app | 5 | 9 | 23 | — |
| cloud-itonami/app-itonami-dougaka | 5 | 13 | 22 | wasm binary 1 を含む |
| ほか単発（apex/awai-os/adserver/torihiki/isco-2641等） | ほか | 6 repos / 6 files / 8 rows | 8 | apex: 1 file / 5 rows |
| **kotoba-lang/kotoba-lang** | （記載なし） | **12** | **20** | 前提に記載のない 1 repo。重複ではなく `kotoba-lang/kotoba` とは別 HEAD の独立 repo |
| **cloud-itonami/app-itonami-animeka** | （記載なし） | **1** | **1** | wasm binary ヒットのみ。テキストヒット 0 |
| **network-awai/awai-os-wt-dandori** | （記載なし＝awai-os の一部？） | **1** | **1** | `awai-os` の linked worktree（別 branch）。`awai-os` 側と別ファイル（`docs/` vs `archive/nixos/docs/`） |

**結論として、前提の 200 ファイルは「生成済みインベントリ・comfy スクリプト・binary・symlink を数えていない何らかの集計」と推測されるが、この回でその集計方法は再現できず未確認。** 本棚卸しは全 tracked ヒットを網羅した実測で جایにする。打ち消し対象の prune 計画に 200 という数字をそのまま使うべきではない。

## 3. LIVE-BINDING（8 行 / 4 ファイル）— binding 削除

`wrangler*.jsonc` の `r2_buckets` / `bucket_name: ai-gftd-*` および D1/service binding の `database_name` / `service` に `ai-gftd-*` が来る非コメント行のみ。wrangler コメント行・`APP_DESCRIPTION` 等の記述は HISTORY に分離。

- cloud-itonami/app-itonami-mangaka `appview/ai-gftd-wasm-mangaka-mng4k4x1/wrangler.jsonc:26` — { "binding": "MANGAKA_DB", "database_name": "ai-gftd-mangaka", "database_id": "534176d4-980b-44d9-ad09-0e3e0ff327d9" }
- cloud-itonami/app-itonami-mangaka `appview/ai-gftd-wasm-mangaka-mng4k4x1/wrangler.jsonc:29` — { "binding": "PDS_SERVICE", "service": "ai-gftd-pds-2603241700" },
- cloud-itonami/app-itonami-mangaka `appview/ai-gftd-wasm-mangaka-mng4k4x1/wrangler.jsonc:30` — { "binding": "PDS_RPC", "service": "ai-gftd-pds-2603241700", "entrypoint": "PdsRPC" }
- cloud-itonami/app-itonami-mangaka `appview/ai-gftd-wasm-mangaka-mng4k4x1/wrangler.worker.jsonc:18` — { "binding": "MANGAKA_DB", "database_name": "ai-gftd-mangaka", "database_id": "534176d4-980b-44d9-ad09-0e3e0ff327d9" }
- cloud-itonami/app-itonami-mangaka `appview/ai-gftd-wasm-mangaka-mng4k4x1/wrangler.worker.jsonc:21` — { "binding": "CACHE_R2", "bucket_name": "ai-gftd-cache" }
- cloud-itonami/app-itonami-mangaka `reader/wrangler.jsonc:18` — { "binding": "MANGAKA_DB", "database_name": "ai-gftd-mangaka", "database_id": "534176d4-980b-44d9-ad09-0e3e0ff327d9" }
- cloud-itonami/app-itonami-shinshi `appview/ai-gftd-wasm-shinshi-sh1n5h1x/wrangler.jsonc:18` — "database_name": "ai-gftd-shinshi",
- cloud-itonami/app-itonami-shinshi `appview/ai-gftd-wasm-shinshi-sh1n5h1x/wrangler.jsonc:26` — "database_name": "ai-gftd-pds-recordlog",

- **内訳**: mangaka 6 行（`appview/ai-gftd-wasm-mangaka-mng4k4x1/wrangler.jsonc` 3 行 + `wrangler.worker.jsonc` 2 行 + `reader/wrangler.jsonc` 1 行）/ shinshi 2 行。その他の repo には wrangler ベースの LIVE-BINDING 行は **0 件**（`network-awai/cloud-murakumo` の `wrangler.toml` はコメントのみ、`kotoba-lang/kotoba` の `.wrangler/cache` はアカウント cache で binding ではない。後者は HISTORY/証跡保持）。
- **注意**: mangaka の service binding `ai-gftd-pds-2603241700` は、リポジトリ内の `redirect/wrangler.jsonc` コメント（「wave2-deleted」）に「旧 editor Worker は存在せず復元できない」と記録されている。**宣言が残っていても実 worker が存在しない可能性があり、本回では Cloudflare 側状態を確認していない（未確認）。bucket を触らない制約のため、実在確認は prune 計画時の別タスク。**
- **D1 の実在**（`ai-gftd-mangaka` / `ai-gftd-shinshi` / `ai-gftd-pds-recordlog`）についても本回では Cloudflare API で確認していない（未確認）。TSV の database_id は wrangler 宣言の転記であり、現存の証明ではない。

## 4. LIVE-CODE（13 行 / 8 ファイル）— fetch 先置換 / namespace 置換

### 4a. fetch（11 行）: fetch 先を yataverse / commit-pin raw に置換

- com-junkawasaki/root `scripts/shinshi-cast-bots/cast_core.cljk:46` — [fetch 先を yataverse / commit-pin raw に置換] (def shinshi-db "ai-gftd-shinshi")
- com-junkawasaki/root `scripts/shinshi-cast-bots/cast_core.cljk:47` — [fetch 先を yataverse / commit-pin raw に置換] (def recordlog-db "ai-gftd-pds-recordlog")
- com-junkawasaki/root `scripts/shinshi-catalog-video-loop.cljk:232` — [fetch 先を yataverse / commit-pin raw に置換] (let [r (let [[bin args] (wrangler-argv ["d1" "execute" "ai-gftd-pds-recordlog"
- com-junkawasaki/root `scripts/shinshi-catalog-video-publish-once.cljk:156` — [fetch 先を yataverse / commit-pin raw に置換] (let [r (let [[bin args] (wrangler-argv ["d1" "execute" "ai-gftd-pds-recordlog"
- com-junkawasaki/root `scripts/shinshi-catalog-video-tick.cljk:185` — [fetch 先を yataverse / commit-pin raw に置換] (let [rows (d1 "ai-gftd-shinshi"
- com-junkawasaki/root `scripts/shinshi-catalog-video-tick.cljk:202` — [fetch 先を yataverse / commit-pin raw に置換] (d1 "ai-gftd-pds-recordlog"
- com-junkawasaki/root `scripts/shinshi-catalog-video-tick.cljk:210` — [fetch 先を yataverse / commit-pin raw に置換] (d1 "ai-gftd-pds-recordlog"
- com-junkawasaki/root `scripts/shinshi-catalog-video-tick.cljk:230` — [fetch 先を yataverse / commit-pin raw に置換] (d1 "ai-gftd-shinshi"
- kotoba-lang/kotoba `lib/kotoba.kotobaseStorage/providers/kotoba.kotobase.storage.s3/test/b2_range_probe.cljk:36` — [fetch 先を yataverse / commit-pin raw に置換] (def service "b2:ai-gftd-datasets")
- kotoba-lang/kotoba `lib/kotoba.kotobaseStorage/providers/kotoba.kotobase.storage.s3/test/b2_range_probe.cljk:37` — [fetch 先を yataverse / commit-pin raw に置換] (def bucket "ai-gftd-datasets")
- kotoba-lang/kotoba `lib/kotoba.kuraNode/script/ingest_shiropico.cljk:73` — [fetch 先を yataverse / commit-pin raw に置換] :bucket "ai-gftd-datasets" :region "us-west-004"

- 内訳: root 7 行（shiropico 系 D1 呼び出し + DB 名定数）/ kotoba 3 行（B2 バケット参照）/ dougaka・mangaka・shinshi には fetch 型 LIVE-CODE が **0 行**（shinshi/mangaka の fetch は §4b の補足参照）。
- **scope 外のライブな実 fetch（`ai-gftd` を含まない行のため TSV に出ない。prune 時に漏れる層）**:
  - `cloud-itonami/app-itonami-mangaka/appview/ai-gftd-wasm-mangaka-mng4k4x1/src/edge-app.ts:28,54,59` — `env.CACHE_R2.put`（`CACHE_R2` は `wrangler.worker.jsonc` の `ai-gftd-cache` binding）。binding 行は TSV にあるが、fetch 本体は `ai-gftd` を含まない
  - `cloud-itonami/app-itonami-mangaka/reader/src/index.ts:25` — `const BLOB_PREFIX = "blobs/mng4k4x1.gftd.ai/"` + `env.CDN.get(...)`（R2 読み。ただし `reader/wrangler.jsonc` の main は `src/worker.js` であり、`index.ts` がデプロイ入口かは本回未確認。`reader/src/worker.js` 側には `ai-gftd-cdn` の fetch は存在せず、`reader/README.md:18` が「never fetches」と明記）
  - `cloud-itonami/app-itonami-mangaka/reader/src/mangaka_reader/img.cljk:23` — `blob-prefix "blobs/mng4k4x1.gftd.ai/"`（legacy R2 フォールバック。`IMG_ORIGIN` があれば R2 に触らない）
  - `RUNBOOK.md:278,282` の `wrangler r2 object put "ai-gftd-cdn/..."` / `wrangler d1 execute ai-gftd-mangaka` は**手動運用コマンド（docs 内）**で、HISTORY（中立化）に分類した。実行すれば bucket/DB を叩くため、運用手順の書き換えは中立化の範囲だが、**bucket は本回触っていない**。

### 4b. dispatch namespace（2 行）: dispatch namespace 置換（要設計）

- `cloud-itonami/app-itonami-mangaka/studio/package.json:10` — `wrangler deploy --dispatch-namespace ai-gftd-repository-dispatch`
- `com-junkawasaki/root/scripts/itonami-fleet/ship.sh:34` — 同 namespace への deploy
- 同 namespace への言及は計 4 行（上記 2 + `studio/wrangler.jsonc:6` コメント + `packages/api/wrangler.toml:13` コメント。後者 2 行は HISTORY）。namespace の置換先・移行要否は**要設計（未確認）**。`appview/.../wrangler.jsonc` の service binding（§3）と一体で扱うべき。

## 5. HISTORY（4,866 行）— 証跡保持 4,569 / 中立化 297

- **中立化（297 行）**: README・RUNBOOK・コードコメント/ドクトークン・blueprint の説明文等の現行文書。prune 方法は「記述を中立化（バケット名を消す）」。JSON/EDN 等の構造化ファイルでは素の文字列削除で壊れるため、parser 意識の置換が必要（§8）。
- **触らない（証跡保持）4,569 行 / 454 ファイル**: 消すと過去の障害・移行・宣伝の証跡が壊れるもの。因果は主に次（機械的に分類。深掘りは §5b の上位ファイル）:
  - **退役・移行 ADR の本文**（`90-docs/adr/260*`、特に wave1/2/3 退役記録、dispatcher/relay 退役）
  - **生成済みインベントリ・マイグレーション台帳**（`90-docs/migration/*.json`、preclassification 等。1 行に数千の path が入る生成物）
  - **fleet 台帳・マニフェスト**（`manifest/fleet-db.ledger.edn`、`manifest/gftd-retirement.*`、`manifest/d1-kotobase-migration.*`、`manifest/west.yml`、service-ownership CSV）
  - **観測/会計台帳**（`canvas-ledger.edn`、`design-quality-ledger.edn`、`kotoba-lang/kotoba/lib/kotoba.kamiWeb/demos/haisen.json` — 2026-04-11 生成のアプリカタログ）
  - **法務文書**（`network-awai/cloud-murakumo/public/legal-terms.html` 等 `ai-gftd-*` 識別子定義 — 中立化は法解釈を変える）
  - **削除のガード test**（`reader/test/worker.test.js:122` の「R2 を使わない」assertion。prune 済み状態の帰結）

### 5b. 証跡保持ファイル（行数上位 30。全体 454 ファイルの詳細は TSV で `prune方法=触らない（証跡保持）` をフィルタ）

- com-junkawasaki/root `90-docs/migration/kotoba-cljc-preclassification.json` — 1434 行
- com-junkawasaki/root `90-docs/business/canvas-ledger.edn` — 889 行
- com-junkawasaki/root `90-docs/migration/kotoba-cljc-inventory.json` — 516 行
- com-junkawasaki/root `90-docs/migration/kotoba-cljc-canonical-admission-matrix.json` — 181 行
- kotoba-lang/kotoba `lib/kotoba.kamiWeb/demos/haisen.json` — 168 行
- com-junkawasaki/root `manifest/fleet-db.ledger.edn` — 167 行
- com-junkawasaki/root `90-docs/migration/kotoba-cljc-project-graphs.json` — 153 行
- com-junkawasaki/root `90-docs/adr/2607289700-org-taxonomy-by-invocation-axis-network-awai.kotoba` — 74 行
- com-junkawasaki/root `90-docs/adr/2607021500-portfolio-bmc-lean.datoms.kotoba` — 41 行
- com-junkawasaki/root `manifest/gftd-retirement.kotoba` — 41 行
- com-junkawasaki/root `manifest/gftd-retirement.edn` — 36 行
- com-junkawasaki/root `manifest/d1-kotobase-migration.edn` — 22 行
- com-junkawasaki/root `manifest/d1-kotobase-migration.kotoba` — 22 行
- com-junkawasaki/root `90-docs/design-quality/design-quality-ledger.edn` — 20 行
- com-junkawasaki/root `90-docs/adr/2608138400-shadow-ignored-content.datoms.kotoba` — 16 行
- com-junkawasaki/root `manifest/checkout-consequence.edn` — 16 行
- com-junkawasaki/root `manifest/repo-taxonomy.edn` — 15 行
- com-junkawasaki/root `90-docs/adr/2607272000-ai-gftd-tia-impersonation-intelligence.kotoba` — 12 行
- com-junkawasaki/root `90-docs/adr/2608135600-shadow-checkout-disposition.kotoba` — 11 行
- com-junkawasaki/root `90-docs/corpus/corpus.datoms.edn` — 11 行
- com-junkawasaki/root `90-docs/migration/kotoba-cljc-compile-probes.json` — 10 行
- com-junkawasaki/root `90-docs/adr/2607302210-global-cybersecurity-competitive-maturity-and-gftd-strategy.kotoba` — 9 行
- network-awai/cloud-itonami `docs/adr/0014-keiei-llm-pool-retirement-disambiguation.md` — 9 行
- cloud-itonami/app-itonami-shinshi `MIGRATION.edn` — 8 行
- com-junkawasaki/root `90-docs/adr/2608221700-dougaka-bots-drive-the-short-video-line.kotoba` — 8 行
- com-junkawasaki/root `90-docs/kotoba-migration/kotoba-migration.datoms.edn` — 8 行
- com-junkawasaki/root `manifest/repo-bots.edn` — 8 行
- com-junkawasaki/root `manifest/repo-maturity.edn` — 8 行
- network-awai/cloud-itonami `docs/adr/0010-itonami-cli-canvas-lean-funding.md` — 8 行
- cloud-itonami/cloud-itonami-app `docs/awai-app-public-endpoint-migration-2026-10-16.csv` — 7 行

- **障害・退役記録の例**（ファイル名で特定できるもの。`INVENTORY.tsv` の該当行を参照）:
  - `com-junkawasaki/root` `90-docs/adr/2607062130-gftdcojp-dispatcher-gftd-ai-retirement-org-wide.kotoba`（dispatcher 530/1033 障害記録 + k8s deprecated prune 指示）
  - `2607062200-gftdcojp-legacy-gftd-ai-hosts-retirement-wave2`、`2607071100-gftdcojp-mangaka-retirement-wave3-aozora-studio`、`2607120000-local-murakumo-relay-gftd-ai-retirement-cloud-murakumo-dispatch`
  - `manifest/gftd-retirement.kotoba` / `.edn`（wave 5 完了記録）
  - `90-docs/business/canvas-ledger.edn`（`/ai-gftd-cdn/blobs/...` 観測行含む）
  - `reader/src/mangaka_reader/img.cljk:4-5`（「bucket を消したら /img が 500 になる」経緯を残すドクトークン。与証跡保持に近いが現行コード文書のため中立化側に分類した。並置するなら archive すべきかは要判断）

## 6. UNRELATED（4 行 / 2 ファイル）— 触らない

- cloud-itonami/app-itonami-shinshi `PROJECT.jsonld:3` — "gftd": "https://resources.gftd.ai/ai-gftd-project-resources/id/",
- cloud-itonami/app-itonami-shinshi `PROJECT.jsonld:5` — "dodaf": "https://resources.gftd.ai/ai-gftd-project-resources/id/DM2/"
- cloud-itonami/app-itonami-shinshi `PROJECT.jsonld:8` — "@id": "https://resources.gftd.ai/ai-gftd-project-shinshi/id/Project/ai-gftd-project-shinshi",
- com-junkawasaki/root `90-docs/adr/2608011100-m365-gftdcojp-tenant-identity-audit-and-offboarding.kotoba:97` — （`ai-gftd-hrse@zoirune.resend.app` / `keiri@gftd.io` / `h.kenichi@gftd.works`）。

- **メールアドレス**: `ai-gftd-hrse@zoirune.resend.app` は、同一 ADR の身元監査記録に列挙された送信先（offboarding 文書）。削除すると別意味（アドレス）が壊れるため触らない。
- **JSON-LD 身元 URL**: `resources.gftd.ai/ai-gftd-project-...` は `PROJECT.jsonld` の語彙 namespace（`@id` / context）。**単に部分文字列を消すと ID が壊れる**。prune するなら namespace 移行（新 canonical ID の設計）が別途要る。本回では UNRELATED/触らないとし、**namespace 移行は未確認タスクとして残す**。

## 7. 未確認（110 行 / 67 ファイル）

- **binary 7 ファイル**（行番号なし、prune 方法「未確認（binary、要再ビルド元確認）」）:
  - `cloud-itonami/app-itonami-animeka/appview/etzhayyim-wasm-animeka-an1m3k4x/svelte/static/timeline-v1/kami_app_animeka_timeline_bg.wasm`
  - `cloud-itonami/app-itonami-dougaka/server/edge/js/offer.wasm`
  - `cloud-itonami/app-itonami-mangaka/appview/etzhayyim-wasm-mangaka-mng4k4x1/svelte/static/scene-3d/kami_mangaka_scene_bg.wasm`
  - `network-awai/network-isekai/packages/app/appview/etzhayyim-wasm-isekai-is3k41w0/svelte/static/kami_web_bg.wasm` / `quarry-walk-v2/kami_app_quarry_walk_bg.wasm`
  - `com-junkawasaki/root/archive/external-clones/etzhayyim-root.delta.bundle` / `mangaka-ghosthacker-assets.full.bundle`
  - `strings` で確認した範囲では、ビルドパスに現れた旧 `.../ai-gftd-apps-gftdcojp/.../*.rs` 等の debug path が含まれる。再ビルドしないと消せない。
- **コードの識別子/絶対パス/テストデータ 103 行**（prune 方法「未確認（コード、要別途設計）」）。内訳（行数）:
- cloud-itonami/app-itonami-mangaka — 56 行
- network-awai/cloud-itonami — 26 行
- com-junkawasaki/root — 8 行
- kotoba-lang/kotoba — 5 行
- cloud-itonami/app-itonami-dougaka — 3 行
- network-awai/cloud-murakumo — 3 行
- cloud-itonami/app-itonami-shinshi — 2 行

  主な実体: mangaka `comfy/` の `/Users/junkawasaki/gftdcojp/.../ai-gftd-project-mangaka/...` 絶対パス直書き（57 行中大半。スクリプト実行時の cwd が前提）、`network-awai/cloud-itonami` の `ai-gftd-apex` namespace/キーワード識別子 26 行（rename 設計要）、`kotoba-lang/kotoba` の B2 テストデータ等 5 行、`root` の plist / checkout パス等 10 行。**勝手な文字列中立化で直ぐに壊れる層**であり、prune 計画では「rename / パス更新（要設計）」として別途扱うべき。

16 files with `ai-gftd` in filename (name appears in TSV `path` column; prune requires rename/move, not content edit):
- com-junkawasaki/root/archive/external-clones/archive_ai-gftd-lf-case-lingling.delta.bundle
- com-junkawasaki/root/90-docs/adr/2607171800-ai-gftd-dougaka-vector-video-workflow.kotoba (and 6 other 90-docs/adr/26*ai-gftd*.kotoba)
- com-junkawasaki/root/90-docs/business/ai-gftd-yukkuri-business-model.edn, ai-gftd-apex-canvas.datoms.edn, ai-gftd-apex-business-model.edn, ai-gftd-yukkuri-canvas.datoms.edn, ai-gftd-yukkuri.kotoba, ai-gftd-apex.kotoba
- cloud-itonami/app-itonami-mangaka/AGENTS.ai-gftd-project-mangaka.md
4 directories with `ai-gftd` in name (directory rename needed):
- cloud-itonami/app-itonami-dougaka/server/appview/ai-gftd-wasm-dougaka-dgk4k7x2
- cloud-itonami/app-itonami-mangaka/appview/ai-gftd-wasm-mangaka-mng4k4x1
- cloud-itonami/app-itonami-shinshi/appview/ai-gftd-wasm-shinshi-sh1n5h1x
- network-awai/cloud-itonami/docs/products/ai-gftd-apex

## 8. 触ってはいけない / 分離すべき repo

- **列挙のみ・変更対象外**（オーナー指示）:
  - `gftdcojp/*`、`mithril-lang/*`、`etzhayyim/*` — `~/github/repos` 配下に **0 件**（`ls ~/github/repos` で確認）。`orgs/gftdcojp/ai-gftd-...` という文字列は `com-junkawasaki/root` の fleet 台帳・移行 ADR 等に大量に現れるが、それは他 repo 行の中の**個所としての履歴言及**であり、別 repo としての checkout は存在しない。SUMMARY/Tsv 上で独立 repo として計上していない。
- **`com-junkawasaki/root` の分離**:
  - 434 files / 4,376 rows（全体の 87%）。0 LIVE-BINDING、9 LIVE-CODE（§4 の D1/shiropico 層 + ship.sh）、HISTORY 4,356（中立化 76 / 証跡保持 4,280）、UNRELATED 1、未確認 10。
  - ホーム設定 repo であり、上記数字にはホームネットワークの fleet 台帳・シークレット配置図・cron 仕事などが含まれる。**prune するなら別判断**が必要（ホーム運用への影響、ledger の書き換え方針など）。
- **`network-awai/awai-os-wt-dandori`** は `awai-os` の linked worktree（別 HEAD `3cde217`）。両方に各 1 行あるが、異なるファイル（`docs/awai-438-r2-inventory-20261113.md` vs `archive/nixos/docs/awai-438-r2-inventory-20261113.md`）。独立 repo としては数えていないが、prune 時は両 worktree とも対象。

## 9. 集計表（repo ごと）

| repo | ファイル数 | 行数（出現行） | LIVE-BINDING | LIVE-CODE（fetch） | LIVE-CODE（ops） | HISTORY | 未確認 | UNRELATED |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| com-junkawasaki/root | 434 | 4376 | 0 | 8 | 1 | 4356（中立化 76 / 証跡保持 4280） | 10 | 1 |
| cloud-itonami/app-itonami-mangaka | 68 | 110 | 6 | 0 | 1 | 46（中立化 41 / 証跡保持 5） | 57 | 0 |
| kotoba-lang/kotoba | 60 | 257 | 0 | 3 | 0 | 249（中立化 62 / 証跡保持 187） | 5 | 0 |
| network-awai/cloud-itonami | 25 | 86 | 0 | 0 | 0 | 60（中立化 30 / 証跡保持 30） | 26 | 0 |
| network-awai/network-isekai | 20 | 21 | 0 | 0 | 0 | 19（中立化 6 / 証跡保持 13） | 2 | 0 |
| network-awai/cloud-murakumo | 19 | 37 | 0 | 0 | 0 | 34（中立化 30 / 証跡保持 4） | 3 | 0 |
| cloud-itonami/app-itonami-shinshi | 15 | 29 | 2 | 0 | 0 | 22（中立化 9 / 証跡保持 13） | 2 | 3 |
| cloud-itonami/app-itonami-dougaka | 13 | 22 | 0 | 0 | 0 | 18（中立化 16 / 証跡保持 2） | 4 | 0 |
| kotoba-lang/kotoba-lang | 12 | 20 | 0 | 0 | 0 | 20（中立化 13 / 証跡保持 7） | 0 | 0 |
| cloud-itonami/cloud-itonami-app | 9 | 23 | 0 | 0 | 0 | 23（中立化 4 / 証跡保持 19） | 0 | 0 |
| cloud-itonami/app-itonami-isekai | 8 | 9 | 0 | 0 | 0 | 9（中立化 9 / 証跡保持 0） | 0 | 0 |
| cloud-itonami/app-itonami-animeka | 1 | 1 | 0 | 0 | 0 | 0（中立化 0 / 証跡保持 0） | 1 | 0 |
| cloud-itonami/app-itonami-cloud-itonami-isco-2641 | 1 | 1 | 0 | 0 | 0 | 1（中立化 1 / 証跡保持 0） | 0 | 0 |
| kotoba-lang/torihiki | 1 | 1 | 0 | 0 | 0 | 1（中立化 0 / 証跡保持 1） | 0 | 0 |
| network-awai/app-itonami-adserver | 1 | 1 | 0 | 0 | 0 | 1（中立化 0 / 証跡保持 1） | 0 | 0 |
| network-awai/awai-os | 1 | 1 | 0 | 0 | 0 | 1（中立化 0 / 証跡保持 1） | 0 | 0 |
| network-awai/awai-os-wt-dandori | 1 | 1 | 0 | 0 | 0 | 1（中立化 0 / 証跡保持 1） | 0 | 0 |
| network-awai/network-awai-apex | 1 | 5 | 0 | 0 | 0 | 5（中立化 0 / 証跡保持 5） | 0 | 0 |
| **合計** | **690** | **5001** | **8** | **11** | **2** | **4866** | **110** | **4** |

- 「行数」は TSV の行数（1 行に複数出現を含む）。ファイル列は distinct ファイル数。HISTORY の括弧内訳は TSV の prune 方法ベース（証跡保持 = 性能・監査・法務の証跡を残すため意図的に触らない）。
- 合計は「4 種類に分類できない行を無理に埋めない」ための未確認を分離した値。合計行数 = LIVE-BINDING + LIVE-CODE + HISTORY + UNRELATED + 未確認。

## 10. 限界（未確認）

- **Cloudflare 側の実在確認はしていない**: D1 `ai-gftd-*`、R2 `ai-gftd-cdn` / `ai-gftd-cache`、B2 `ai-gftd-datasets`、dispatch namespace の現存有無は未確認（bucket を触らない制約）。§3 の service binding の dead 情報は repo 内コメントの転記。
- **runtime 読取りの追跡はしていない**: HISTORY の「動作に影響しない」はファイルの役割（docs/データをコード vs docs）に基づく判定で、各ファイルの runtime リーダーを全追跡した推定ではない。特に `*.json` の生成カタログ・`blueprint.edn` の compat ターゲット等の構造データについて、読むコードの有無は未確認。
- **untracked/ignored は未計測**: `git grep` は tracked のみ。untracked ファイル内に `ai-gftd` がある場合は数えていない。
- **`gftd.ai` のみの参照は対象外**: `blobs/mng4k4x1.gftd.ai` や `manga.gftd.ai/*` route 等 `ai-gftd` を含まない gftd.ai 参照は本棚卸しのスコープ外（route 宣言も別途別観点）。swiping GFTD を本当に全体化したい場合は `gftd.ai`（例: `blobs/`）
  でも併せて棚卸しすべき。
- **一括置換できない**: EDN/JSON/KOTOBA の単一行データや `PROJECT.jsonld` の ID は、単純な文字列置換で構造・ID が壊れる。prune 時は parser 感知の改書きか ID 移行が要る。
- **1 行複数出現の圧縮**: 巨大な単一行（最大 3.7M 文字）内に `ai-gftd` が多数出現しても 1 行として 1 件分だけ分類した。文字列出現の多さ（7044 件）が repo 別負担を直接示すわけではない。
