# ADR: awai apps / itonami dapps / bots は R2 に依存しない。yataverse.com の protocol だけに依存する

- 日付: 2026-11-23

- 状態: 決定（owner 2026-11-23）。コード変更はしていない（本 ADR のみ）

- 上位: [AOSP platform decision](../otehon/aosp-platform-decision-20261117.md)

- 先行: [yataverse service 位置づけ](https://github.com/network-awai/network-awai-apex/blob/main/docs/adr/0050-kotobase-is-a-library-yataverse-is-the-service.md)（ADR 0050, 2026-11-21）

- 棚卸し範囲: `~/github/repos` 配下の全 checkout を `r2_buckets` / `bucket_name` / `R2.` / `blobs/` の 4 pattern で grep（`.git`/`node_modules` 除外）


## 背景

オーナー決定 2026-11-23: **awai apps / itonami dapps / bots は R2 に依存しない。yataverse.com の protocol だけに依存する。**


R2 は bucket 内に鍵を閉じる。bucket が存在しなければその Worker の該当経路は 500 になる単一障害点である。実例は既に起きている: mangaka reader（`mangaka.itonami.cloud/img/<key>`、bucket `ai-gftd-cdn`）が bucket 不在で 500（`get: The specified bucket does not exist.`、CF error `10006`）になった。現行コード `reader/src/mangaka_reader/img.cljk` はこの経緯を docstring に記録し、全失敗を 404 `image-unavailable` に変換しているが、デフォルト `IMG_ORIGIN=""` のままでは legacy R2 経路が生きている。鍵が bucket スコープであること（endpoint・key・bucket がセット単位）に加え、CF のネームスペースと GFTD のアプリ名（`ai-gftd-*`、`mng4k4x1.gftd.ai` の key prefix）が混在し、退役・移送・権限の境界が読み取りにくい。


先行例は既にある: `network-awai/cloud-itonami` の `wrangler.jsonc` は「No R2 bindings (2026-10-07)」と宣言し、`test/no_r2_bindings_test.cljk` が R2 binding の再出現を fail する。bytes plane の本家 `network-awai/app-itonami-yataverse` の Worker（`yataverse-bytes`）の `wrangler.jsonc` も「No R2, KV, D1 or Durable Objects」と宣言し、B2 を yataverse.com の裏に隠して `GET /ipfs/<cid>` / `yataverse put` の protocol だけを外部に露出している。本決定はこの 2 つの先行を全体方針に格上げする。


## 決定


1. 読み書きは yataverse の content-addressed block に統一する（`GET https://yataverse.com/ipfs/<cid>` 読み、`yataverse put` + CACAO 書き）。アプリ・dapp・bot が外部に見るのは yataverse.com の protocol であり、裏の B2/R2 の選択は yataverse 側の責任である。

2. 次のものを新規に作らない:

   - R2 binding（`r2_buckets` 宣言）

   - b2 bucket 参照（B2 SigV4 の直接読み書き。mangaka の `blob/[cid]/+server.ts` のような直結は同格）

   - `blobs/<prefix>` の直読み（bucket 内 key 規約への依存）

3. **D1 / KV / secrets は対象外。** R2 だけを外す。

4. 移行期の明示対応表（`IMG_KEY_MAP` のような「legacy key → CID」の表）は許す。表は sunset 付きで明示し、consumer 側に無言の正規化を残さない。

5. 本 ADR はコードを変更しない。bucket も作らない・消さない・データを移さない。移行は各 repo で本 ADR に基づき PR 単位で進める。


## 移行


1. **mangaka reader（進行中）:** `/img` の解決を yataverse 直結（`IMG_ORIGIN` 相当の upstream スロット + key→CID 対応表）に書き換える。実測（2026-11-23 時点）では `reader/src/mangaka_reader/img.cljk` が `IMG_ORIGIN` 設定時 upstream fetch・未設定時 legacy R2 の二股を実装し、失敗は 404 変換済み。`r2_buckets` 宣言（`wrangler.jsonc` の `ai-gftd-cdn`）と legacy コード（`reader/src/index.ts` の R2 CDN 経路、`worker.cljk` の binding 記述）がまだ残る。

2. 他 repo は下記棚卸し表の順に（優先順位 ①→③）。「yataverse 置換可」はコード変更で足りるもの、「要データ移送」は bucket→yataverse の取り込みが先に要るもの。

3. 移行が済んだ binding は `r2_buckets` 宣言から外し、`no_r2_bindings_test.cljk` 型の断言を残す。


## 棚卸し表（実測 2026-11-23）


grep 結果: **146 ファイル**（17 repo、うち `network-awai/awai-os-wt-dandori` は `awai-os` の worktree の重複を含む）。4 pattern の内訳: binding 宣言を含む wrangler config 15 ファイル（distinct bucket 名 **10**）、`R2.` 言及の残り、純 `blobs/` のみ。bucket の存在は in-repo の宣言だけで確認し、実 bucket の存在・データ量はクエリしていない。


### A. live binding（`r2_buckets` 宣言のある wrangler config・15 ファイル／bucket 10 個）


> 優先順位: ① 本番で 500 になっているもの ② APK/配布物の配信 ③ ベンチ・試験用。


| repo | path | 種類 | bucket 名 | 代替案 |
|---|---|---|---|---|
| cloud-itonami/app-itonami-animeka | `appview/etzhayyim-wasm-animeka-an1m3k4x/wrangler.jsonc` | binding (YATA_R2/CACHE_R2) | `etzhayyim-cache` | yataverse 置換可（キャッシュ層） |
| cloud-itonami/app-itonami-mangaka | `appview/ai-gftd-wasm-mangaka-mng4k4x1/wrangler.worker.jsonc` | binding + cache put | `ai-gftd-cache` | yataverse 置換可（キャッシュ層） |
| cloud-itonami/app-itonami-mangaka | `appview/etzhayyim-wasm-mangaka-mng4k4x1/wrangler.jsonc` | binding (YATA_R2/CACHE_R2) | `etzhayyim-cache` | yataverse 置換可（キャッシュ層） |
| cloud-itonami/app-itonami-mangaka | `reader/wrangler.jsonc` | binding + direct read (reader /img) | `ai-gftd-cdn` | yataverse 置換可（key→CID 対応表） |
| kotoba-lang/kotoba | `lib/kotoba.kaigi/worker/wrangler.jsonc` | binding (recording store) | `kaigi-recordings` | 要データ移送 |
| kotoba-lang/kotoba | `lib/kotoba.kotobaseProtocols/worker/wrangler.jsonc` | binding (git object store) | `kotobase-git-objects` | 要データ移送（git object は内容アドレス済み） |
| kotoba-lang/kotoba | `lib/kotoba.kotobaseProtocols/wrangler.jsonc` | binding (git object store) | `kotobase-git-objects` | 要データ移送（git object は内容アドレス済み） |
| kotoba-lang/kotoba | `lib/kotoba.kotobaseStorage/providers/kotoba.kotobase.storage.s3/wrangler.r2-bench.jsonc` | binding (bench) | `kotobase-merkle-lsm` | 対象外（ベンチ・試験） |
| network-awai/awai-os-wt-dandori | `distribution/wrangler.jsonc` | binding + get/put (配布 Worker) | `aiueos-releases` | 要データ移送（yataverse blocks 取り込み） |
| network-awai/awai-os | `distribution/wrangler.jsonc` | binding + get/put (配布 Worker) | `aiueos-releases` | 要データ移送（yataverse blocks 取り込み） |
| network-awai/cloud-murakumo-usb-installer | `distribution/wrangler.jsonc` | binding + get/put (配布 Worker) | `aiueos-releases` | 要データ移送（yataverse blocks 取り込み） |
| network-awai/cloud-murakumo | `packages/api/wrangler.toml` | binding (model hosting bytes) | `kotobase-merkle-lsm` | 要データ移送 |
| network-awai/cloud-murakumo | `packages/api/wrangler.yata-local-test.toml` | binding (local test) | `murakumo-yata-local-test` | 対象外（ローカル試験） |
| network-awai/network-isekai | `workers/sekaiju/wrangler.jsonc` | binding (fiction state) | `network-isekai-sekaiju-data` | 要データ移送（状態の block 化を含む） |
| network-awai/network-isekai | `workers/social-rooms/wrangler.toml` | binding (chat state) | `network-isekai-social-rooms-data` | 要データ移送（bucket 不在の記録あり→先に状態 plane を決定） |

### B. その他（`R2.` / `blobs/` 言及のみ・131 ファイル）


| repo | path | pattern | 種類 | bucket | 代替案 |
|---|---|---|---|---|---|
| cloud-itonami/app-itonami-animeka | `AGENTS.md` | blobs/ | B2/PDS blob key doc | — | 対象外（R2 scope 外） |
| cloud-itonami/app-itonami-mangaka | `AGENTS.md` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `RUNBOOK.md` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `appview/ai-gftd-wasm-mangaka-mng4k4x1/src/edge-app.ts` | R2. | code (CACHE_R2 cache put) | — | yataverse 置換可（キャッシュ層） |
| cloud-itonami/app-itonami-mangaka | `appview/etzhayyim-wasm-mangaka-mng4k4x1/svelte/src/routes/blob/[cid]/+server.ts` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `comfy/lg_mangaka/blob.py` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `comfy/lg_mangaka/tools.py` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `comfy/scripts/demo_outputs/02_asset_refs.json` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `comfy/scripts/demo_outputs/04_scene_dag.json` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `comfy/scripts/demo_pipeline.py` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `data/ghosthacker/VRM_INGEST.md` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `lg-image-gen/src/lib/compose-scene-3d-client.test.ts` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `lg-image-gen/src/lib/compose-scene-3d-client.ts` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `lg/lg_mangaka/blob.py` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `lg/lg_mangaka/graphs/compose_scene_3d.py` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `lg/lg_mangaka/server.py` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `lg/lg_mangaka/tools.py` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `lg/scripts/demo_outputs/02_asset_refs.json` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `lg/scripts/demo_outputs/04_scene_dag.json` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `lg/scripts/demo_pipeline.py` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `lg/tests/test_aggregate_critique.py` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `lg/tests/test_attach_character_vrm.py` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `lg/tests/test_compose_scene_3d_p3.py` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `lg/tests/test_compose_scene_3d_p4.py` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `lg/tests/test_compose_scene_3d_phase_c_parity.py` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `lg/tests/test_hume_distill.py` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `lg/tests/test_hume_persistence.py` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `lg/tests/test_llm_vision_node.py` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `reader/README.md` | blobs/ | reader (R2/blob prefix) | — | yataverse 置換可（key→CID 対応表） |
| cloud-itonami/app-itonami-mangaka | `reader/src/index.ts` | blobs/ | reader (R2/blob prefix) | — | yataverse 置換可（key→CID 対応表） |
| cloud-itonami/app-itonami-mangaka | `reader/src/mangaka_reader/img.cljk` | blobs/ | reader (R2/blob prefix) | — | yataverse 置換可（key→CID 対応表） |
| cloud-itonami/app-itonami-mangaka | `reader/src/mangaka_reader/worker.cljk` | R2. | reader (R2/blob prefix) | — | yataverse 置換可（key→CID 対応表） |
| cloud-itonami/app-itonami-mangaka | `reader/test/mangaka_reader/img_test.cljk` | blobs/ | reader (R2/blob prefix) | — | yataverse 置換可（key→CID 対応表） |
| cloud-itonami/app-itonami-mangaka | `scripts/author-ghosthacker-vrms.ts` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `scripts/import-jump-page.ts` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-mangaka | `scripts/ingest-vrms.ts` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-ongakuka | `README.md` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-ongakuka | `docs/adr/0001-the-deployed-worker-is-not-the-file-you-open.edn` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-ongakuka | `docs/adr/0002-migrate-the-appview-from-typescript-to-clojurescript.edn` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-ongakuka | `docs/operator-quickstart.md` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-shinshi | `AGENTS.md` | R2./blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-shinshi | `appview/ai-gftd-wasm-shinshi-sh1n5h1x/svelte/src/lib/api/image-url.test.ts` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/app-itonami-shinshi | `appview/ai-gftd-wasm-shinshi-sh1n5h1x/svelte/src/lib/api/image-url.ts` | blobs/ | B2/PDS blob key convention | — | 対象外（R2 scope 外・B2 直接読みは隣接課題） |
| cloud-itonami/cloud-itonami-app | `src/cloud/itonami/app/storj_node.cljk` | blobs/ | Storj namespace blobs/ | — | 対象外（別 plane） |
| com-junkawasaki/root | `90-docs/adr/2607021800-etzhayyim-junbi-reserve-basket.kotoba` | R2. | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `90-docs/adr/2607161930-animeka-production-quality-loop.kotoba` | blobs/ | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `90-docs/adr/2607301500-dev-yaoi-pairing-first-bl-platform.kotoba` | r2_buckets | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `90-docs/adr/2608100100-s3-kotobase-net-object-plane-deployed-commit-cost.kotoba` | blobs/ | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `90-docs/adr/2608170100-aozora-discovery-crossed-graphs-and-relay-read-collapse.kotoba` | r2_buckets | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `90-docs/adr/2608170600-lake-catalog-write-surface.kotoba` | blobs/ | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `90-docs/adr/2608220100-sanction-survivable-architecture.kotoba` | r2_buckets | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `90-docs/adr/2608620000-kaisya-email-entrance-and-mcp-edge-scope.kotoba` | blobs/ | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `90-docs/adr/2609111250-k16-pxe-server-waits-for-the-wire-instead-of-aborting.kotoba` | blobs/ | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `90-docs/business/canvas-ledger.edn` | blobs/ | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `90-docs/protocols/kotoba-resource-protocol.edn` | blobs/ | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `90-docs/repo-reality/verify_kototama.cljk` | R2. | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `90-docs/storage/itonami-datalake-ipfs-migration.md` | R2. | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `deps.edn` | blobs/ | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `manifest/decentralized-services.edn` | R2. | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `manifest/decentralized-services.kotoba` | R2. | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `manifest/repository-rules.edn` | R2. | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `manifest/repository-rules.kotoba` | R2. | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `scripts/cleanup-land.cljk` | blobs/ | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `scripts/datalake-ipfs-replicate.py` | R2. | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `scripts/gen-compliance-scope.cljk` | r2_buckets/bucket_name | script（IaC 分類器・r2 の語彙） | — | 対象外（記録/分類） |
| com-junkawasaki/root | `scripts/hermes-knowledge-datasets/exchange_sec_seed.py` | R2. | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `scripts/ledger-land.cljk` | blobs/ | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `scripts/m365-annex-offhost-recovery.py` | R2. | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `scripts/novelty-chain-shape.cljk` | R2. | record (ADR/docs/manifest) | — | 対象外（記録） |
| com-junkawasaki/root | `scripts/rad-register.cljk` | blobs/ | record (ADR/docs/manifest) | — | 対象外（記録） |
| kotoba-lang/kotoba | `lib/kotoba.blockCache/src/block/cache.cljk` | R2. | comment/test doc | — | 対象外（記録） |
| kotoba-lang/kotoba | `lib/kotoba.blockCache/src/block/cache/worker.cljk` | R2. | comment/test doc | — | 対象外（記録） |
| kotoba-lang/kotoba | `lib/kotoba.cloudMurakumoStudio/src/murakumo_studio/models.cljk` | blobs/ | local CAS layout models/blobs | — | 対象外（B2/R2 非依存） |
| kotoba-lang/kotoba | `lib/kotoba.commonCrawl/scripts/archive/phase3c_hyperdrive_ingest.py` | bucket_name | archived ingest (s3.bucket_name SQL) | — | 対象外（記録） |
| kotoba-lang/kotoba | `lib/kotoba.commonCrawl/scripts/archive/phase3e_direct_ingest.py` | bucket_name | archived ingest (s3.bucket_name SQL) | — | 対象外（記録） |
| kotoba-lang/kotoba | `lib/kotoba.commonCrawl/scripts/archive/phase3f_staging_ingest.py` | bucket_name | archived ingest (s3.bucket_name SQL) | — | 対象外（記録） |
| kotoba-lang/kotoba | `lib/kotoba.fune/kotoba/fune/layout_check.kotoba` | blobs/ | OCI /blobs/sha256 (spec) | — | 誤検出（対象外） |
| kotoba-lang/kotoba | `lib/kotoba.fune/kotoba/fune/layout_process.kotoba` | blobs/ | OCI /blobs/sha256 (spec) | — | 誤検出（対象外） |
| kotoba-lang/kotoba | `lib/kotoba.fune/kotoba/fune/layout_stream.kotoba` | blobs/ | OCI /blobs/sha256 (spec) | — | 誤検出（対象外） |
| kotoba-lang/kotoba | `lib/kotoba.fune/test/fune/rootfs_stream_runner.kotoba` | blobs/ | OCI /blobs/sha256 (spec) | — | 誤検出（対象外） |
| kotoba-lang/kotoba | `lib/kotoba.fune/test/fune/stage_layout_fixtures.py` | blobs/ | OCI /blobs/sha256 (spec) | — | 誤検出（対象外） |
| kotoba-lang/kotoba | `lib/kotoba.fune/test/fune/stage_limit_layout.py` | blobs/ | OCI /blobs/sha256 (spec) | — | 誤検出（対象外） |
| kotoba-lang/kotoba | `lib/kotoba.fune/test/fune/stage_process_layouts.py` | blobs/ | OCI /blobs/sha256 (spec) | — | 誤検出（対象外） |
| kotoba-lang/kotoba | `lib/kotoba.ioStorjNode/README.md` | blobs/ | Storj namespace blobs/ | — | 対象外（別 plane） |
| kotoba-lang/kotoba | `lib/kotoba.ioStorjNode/scripts/tls_peer.cljk` | blobs/ | Storj namespace blobs/ | — | 対象外（別 plane） |
| kotoba-lang/kotoba | `lib/kotoba.ioStorjNode/test/storj/node/service_test.cljk` | blobs/ | Storj namespace blobs/ | — | 対象外（別 plane） |
| kotoba-lang/kotoba | `lib/kotoba.ioStorjNode/test/storj/node/transfer_test.cljk` | blobs/ | Storj namespace blobs/ | — | 対象外（別 plane） |
| kotoba-lang/kotoba | `lib/kotoba.kotobaTopology/language_graph_topology_paper.pdf` | R2. | binary | — | 誤検出 |
| kotoba-lang/kotoba | `lib/kotoba.kotobaseBrowserWorker/src/kotobase/browser_worker/browser.cljk` | R2. | comment/test doc | — | 対象外（記録） |
| kotoba-lang/kotoba | `lib/kotoba.kotobaseProtocolCore/test/kotobase/protocols/blocks_test.cljk` | R2. | comment/test doc | — | 対象外（記録） |
| kotoba-lang/kotoba | `lib/kotoba.kotobaseProtocols/test/kotobase/protocols/blocks_test.cljk` | R2. | comment/test doc | — | 対象外（記録） |
| kotoba-lang/kotoba | `lib/kotoba.kotobaseStorage/providers/kotoba.kotobase.storage.s3/scripts/test-compiled.py` | R2. | S3-compat provider (R2 は endpoint の一例) | — | 対象外（provider 一つ・新規 binding 禁止） |
| kotoba-lang/kotoba | `lib/kotoba.kotobaseStorage/providers/kotoba.kotobase.storage.s3/src/kotobase/storage/object_s3.cljk` | R2. | S3-compat provider (R2 は endpoint の一例) | — | 対象外（provider 一つ・新規 binding 禁止） |
| kotoba-lang/kotoba | `lib/kotoba.kotobaseStorage/providers/kotoba.kotobase.storage.s3/test/b2_range_probe.cljk` | R2. | bench/test (live R2 対照) | — | 対象外（ベンチ・試験） |
| kotoba-lang/kotoba | `lib/kotoba.kotobaseStorage/providers/kotoba.kotobase.storage.s3/test/r2.cljk` | R2. | bench/test (live R2 対照) | — | 対象外（ベンチ・試験） |
| kotoba-lang/kotoba | `lib/kotoba.kotobaseStorage/providers/kotoba.kotobase.storage.s3/test/r2_live_bench.cljk` | R2. | bench/test (live R2 対照) | — | 対象外（ベンチ・試験） |
| kotoba-lang/kotoba | `lib/kotoba.kotobaseStorage/providers/kotoba.kotobase.storage.s3/test/r2_live_worker.cljk` | R2. | bench/test (live R2 対照) | — | 対象外（ベンチ・試験） |
| kotoba-lang/kotoba | `lib/kotoba.lexiconsBundle/src/lexicons.gen.json` | R2./blobs/ | generated dict | — | 対象外（生成物） |
| kotoba-lang/kotoba | `lib/kotoba.ooyake/MATURITY.md` | R2. | code (R2 言及) | — | 要確認 |
| kotoba-lang/kotoba | `lib/kotoba.tenken/test/tenken_test.cljk` | r2_buckets | test fixture（文字列） | — | 対象外（記録/分類） |
| kotoba-lang/kotoba | `lib/org.opencontainers.distribution/README.md` | blobs/ | OCI /blobs/sha256 (spec) | — | 誤検出（対象外） |
| kotoba-lang/kotoba | `lib/org.opencontainers.distribution/src/kotobase/protocols/oci.cljk` | blobs/ | OCI /blobs/sha256 (spec) | — | 誤検出（対象外） |
| kotoba-lang/kotoba | `lib/org.opencontainers.distribution/test/kotobase/protocols/oci_test.cljk` | blobs/ | OCI /blobs/sha256 (spec) | — | 誤検出（対象外） |
| kotoba-lang/kotoba-lang | `lang/compat/block/cache.kotoba` | R2. | comment/test doc | — | 対象外（記録） |
| kotoba-lang/kotoba-lang | `lang/compat/block/cache/worker.kotoba` | R2. | comment/test doc | — | 対象外（記録） |
| kotoba-lang/kotoba-lang | `lang/compat/kotoba/compiler/host_profile.kotoba` | r2_buckets/bucket_name | compiler taxonomy（r2_buckets 語彙） | — | 対象外（記録/分類） |
| kotoba-lang/org-babashka-nbb | `lib/nbb_spec.js` | R2. | vendored/minified（var R2） | — | 誤検出 |
| network-awai/app-itonami-yataverse | `app/generated/core.js` | R2. | generated/minified | — | 誤検出 |
| network-awai/app-tabi-mikake | `itonami/profiles/tabi-mikake/SOUL.md` | R2. | profile doc | — | 対象外（記録） |
| network-awai/cloud-itonami | `docs/adr/0030-workspace-cloud-m365-scale-architecture.md` | R2. | doc/comment (R2 を使わない宣言・現状記録) | — | 対象外（記録） |
| network-awai/cloud-itonami | `functions/_middleware.js` | R2. | doc/comment (R2 を使わない宣言・現状記録) | — | 対象外（記録） |
| network-awai/cloud-itonami | `ops/independent/private_staging_store.mjs` | R2. | doc/comment (R2 を使わない宣言・現状記録) | — | 対象外（記録） |
| network-awai/cloud-itonami | `scripts/deploy-site.cljk` | R2. | doc/comment (R2 を使わない宣言・現状記録) | — | 対象外（記録） |
| network-awai/cloud-itonami | `scripts/mail-drain.cljk` | R2. | doc/comment (R2 を使わない宣言・現状記録) | — | 対象外（記録） |
| network-awai/cloud-itonami | `scripts/private-staging.cljk` | R2. | doc/comment (R2 を使わない宣言・現状記録) | — | 対象外（記録） |
| network-awai/cloud-itonami | `shared/private-staging.js` | R2. | doc/comment (R2 を使わない宣言・現状記録) | — | 対象外（記録） |
| network-awai/cloud-itonami | `src/cloud_itonami/edge/drive_store.cljk` | R2. | code (ITONAMI_DRIVE 未宣言 binding 参照、binding absent 時 500) | — | yataverse 置換可（Drive pack 前例） |
| network-awai/cloud-itonami | `test/no_r2_bindings_test.cljk` | r2_buckets/bucket_name/R2. | test（R2 binding 禁止を assert） | — | 対象外（安全側の証拠） |
| network-awai/cloud-itonami | `test/private-staging-config.test.mjs` | r2_buckets/R2. | test（R2 無しを assert） | — | 対象外（安全側の証拠） |
| network-awai/cloud-itonami | `workers/grok-bots/hyakka_knowledge_runtime.js` | R2. | doc/comment (R2 を使わない宣言・現状記録) | — | 対象外（記録） |
| network-awai/cloud-murakumo | `migrations/model-registry/0001_model_hosting_projection.sql` | R2. | code (model-hosting bytes) | — | 要データ移送 |
| network-awai/cloud-murakumo | `migrations/model-registry/0003_model_hosting_provenance_projection.sql` | R2. | code (model-hosting bytes) | — | 要データ移送 |
| network-awai/cloud-murakumo | `migrations/model-registry/0005_model_hosting_trust_operations.sql` | R2. | code (model-hosting bytes) | — | 要データ移送 |
| network-awai/cloud-murakumo | `packages/api/test/itonami_bot_runtime_do.test.js` | R2. | code (model-hosting bytes) | — | 要データ移送 |
| network-awai/cloud-murakumo | `packages/app/scripts/fleet-console-server.cljk` | blobs/ | help text (blobs/ 文字列) | — | 対象外（記録） |
| network-awai/cloud-murakumo | `src/cloud_murakumo/model_hosting_phase2_http.cljk` | R2. | code (model-hosting bytes) | — | 要データ移送 |
| network-awai/cloud-murakumo | `src/cloud_murakumo/model_hosting_storage.cljk` | R2. | code (model-hosting bytes) | — | 要データ移送 |
| network-awai/cloud-murakumo | `src/cloud_murakumo/status_worker.cljk` | R2. | record (R2 除去済みの宣言/回想) | — | 対象外（記録） |
| network-awai/cloud-murakumo | `test/status_r2_conformance_test.mjs` | R2. | record (R2 除去済みの宣言/回想) | — | 対象外（記録） |
| network-awai/cloud-murakumo | `wrangler.jsonc` | R2. | record (R2 除去済みの宣言/回想) | — | 対象外（記録） |
| network-awai/network-isekai | `src/isekai/fork_git.cljk` | blobs/ | code (fork_git objects) | — | 対象外（git object 語彙） |

## 対象外・誤検出の注記


- **OCI の `/blobs/sha256/`**（`kotoba.fune`、`org.opencontainers.distribution`）は Docker 仕様の語彙であり R2 依存ではない: 誤検出。
- **`git/blobs/<sha>`**（GitHub API、com-junkawasaki root scripts）は git object API: 誤検出。
- **Storj の `blobs/in-memory`**（`ioStorjNode`、cloud-itonami-app `storj_node.cljk`）は別 plane の namespace: 対象外。
- **B2 / PDS の `blobs/anonymous/{sha256}` 鍵規約**（mangaka、shinshi、ongakuka、animeka の AGENTS/docs/python）は R2 ではないので本 ADR の scope 外。ただし「bucket スコープ鍵への直結」という同型の問題であり、yataverse protocol への寄せは別途の方針で扱う。
- **S3-compatible provider**（`kotoba.kotobaseStorage.providers.kotoba.kotobase.storage.s3`）は R2 を endpoint の一例として扱う抽象層: 対象外。`wrangler.r2-bench.jsonc`（`kotobase-merkle-lsm`）と `r2_live_*` はベンチ・試験用のため対象外（優先順位 ③）。
- **記録・分類器・fixture**（com-junkawasaki root の ADR/docs、`gen-compliance-scope.cljk`、`host_profile.kotoba`、tenken の fixture、`tabi-mikake` SOUL.md の「nothing writes to R2」宣言など）: 対象外。
- **minified / generated / binary**（`nbb_spec.js`、`app-itonami-yataverse/app/generated/core.js`、`language_graph_topology_paper.pdf`、`lexicons.gen.json`）: 誤検出。

## 結果と残り


本 ADR は方針の記録と現状の棚卸しのみであり、コード・bucket・データの変更はしていない。移行は各 repo の PR で順次実施し、binding 宣言を外した repo には `no_r2_bindings_test` 型の断言の新設を推奨する。bucket の実在確認とデータ移送は本 ADR の範囲外であり、実施時は別途 owner 承認を要する。


優先順位（再掲）: ① mangaka reader（`ai-gftd-cdn`、本番 500 の実例）② awai-os `distribution/`（`aiueos-releases`、APK/配布物）③ `kotoba.kotobaseStorage…/wrangler.r2-bench.jsonc`（ベンチ・試験用）。
