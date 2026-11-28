# Bengoshi — 弁護士検索ガイド・中立ディレクトリ（準備中）

`network.itonami.bengoshi` — 公的弁護士検索ガイド（MOJ 2026 注 20 準拠）および完全無料（対価 ¥0）・厳格中立ディレクトリ構造のプレビュー実装です。

> **プレビュー版（架空サンプル表示）**: 実在する弁護士・法律事務所の掲載・登録受付・連絡取次は外部弁護士確認（O10）の完了後に開始します。本ビルド内のサンプル弁護士（`990001`–`990006`）はすべて `synthetic: true`・`.invalid` ドメインの架空データです。

## 最小安全公開スコープ（Today's Minimum Safe Scope）

1. **既定ランディング画面 — 公的弁護士検索ガイド（MOJ 2026 注 20 準拠）**:
   - 日弁連「弁護士情報検索」(`https://member.nichibenren.or.jp/general_search`)
   - ひまわりサーチ (`https://www.bengoshikai.jp/`)
   - 法テラス (`https://www.houterasu.or.jp/`)
   - 全国弁護士会 法律相談センター案内 (`https://www.nichibenren.or.jp/legal_advice/search/center.html`)
2. **弁護士掲載ポリシー（プレビュー）**:
   - 完全無料・対価 ¥0、7 遮断境界、O4 手動確認、日弁連 業務広告規程 11 条 3 年保存エクスポート対応予定、O10 完了後に受付開始。
3. **フッター運営者開示スロット (`src/operator-disclosure.js`)**:
   - `PENDING_OWNER_CONFIRMATION_LEGAL_224` マーカー付きで Legal #224 確定情報を安全に差し込める構造。

## 構造的不変条件（コード・スキーマ・UI・負例テストで強制）

1. **外部通信ゼロ（`app-descriptor.json`: `"operations": []`）**:
   - Web / Tauri アプリから外部 API への通信は一切行いません。Android Manifest にも `android.permission.INTERNET` を付与しません（`android:allowBackup="false"`）。
   - Web `dist/index.html` の `<meta CSP>` は `connect-src 'none'` + `<meta name="referrer" content="no-referrer">` を強制します。
2. **完全無料・対価 ¥0（`O2 = none`）**:
   - 利用者・弁護士双方に完全無料（`fee_jpy: 0`）。広告枠、報酬分配、有料枠、トークン報酬は存在しません。
3. **厳格中立（`O9` — 日弁連 業務広告規程 会規44号・指針第3-12 準拠）**:
   - 専門標榜・誇大比較・勝訴率・解決件数・口コミ星評価・順位付け・スカウト／逆オファー・オンライン委任契約締結をバリデータおよび操作層で拒否します。
   - 中立並び替えのみ: 五十音順 (`kana_asc`)、登録番号順 (`reg_no_asc`)、地域コード順 (`prefecture_asc`)。
   - 日弁連 業務広告規程 11 条（令和 8 年 7 月 1 日施行済み）の 3 年保存向けエクスポート操作 `lawyer.export_art11_record` を提供します。
4. **方式 A 直接連絡（サーバ中継なし）＋ O4 資格照合状態機械**:
   - 弁護士の公開事務所 URL・`mailto:`・`tel:` への直接遷移と、7 行の「連絡先をコピー」＋「下書きをコピー」を主導線とします。
   - `expired` / `suspended_or_revoked` は HARD HOLD として手動連絡先コピーおよび連絡操作をブロックします。
5. **Soudan 連携（`soudan.memo.export.v1`）と URL クエリ遮断**:
   - `template: "consultation-memo.jpn.v1"`、`category`、`wish`、`deadline`（カウントダウン計算なし）、`documents`、`evidence_manifest` 全項目を端末内ローカルで取り込みます。
   - URL クエリ経由の相談本文・タグ注入（`Soudan` → `Bengoshi` 境界）は無視・拒否します。
6. **弁護士利益相反確認 HARD ゲート（`AWAI-3235`・ローカルプレビュー／オフライン読込専用）**:
   - 受信一覧は最小ヘッダ（依頼者名・相手方名・分野）のみ表示し、ローカル台帳照合＋確認記録まで本文復号をブロックします（サーバ中継なし）。

## MCP Apps / Agent Plugin（POC / Draft）

- `agent-plugin/`（`plugin.json`, `mcp.json`, `skills/bengoshi/SKILL.md`）および `embed.mcp` は **POC / Draft** です（正式な `AWAI-4143` 適合主張は未確定）。
- 製品 UI に ACP は含みません（`AWAI-4003` #07）。
- `directory.search` / `lawyer.get` の非 UI フォールバック（`content` + `structuredContent`）は常に規程 9 条必須項目（氏名・所属弁護士会）、中立注記、エージェント非推奨ガードを含みます。

## Build & Verification

```sh
cd apps/bengoshi
npm run build            # Produces self-contained static Web bundle in dist/ with pinned release.json
npm test                 # Runs node --test test/*.test.mjs && node scripts/check-public.mjs
cd src-tauri && cargo check   # Verifies Tauri v3 host compilation & Android 16 KB build script
```

## Paths for Downstream Teams

- **Static Web bundle (`https://bengoshi.itonami.app`)**: `apps/bengoshi/dist/`
- **Public safety gate script**: `apps/bengoshi/scripts/check-public.mjs`
- **Tauri v3 native host & Android 16 KB project**: `apps/bengoshi/src-tauri/`
- **Runtime descriptor (`operations: []`)**: `apps/bengoshi/app-descriptor.json`
- **Agent Plugin (POC / Draft)**: `apps/bengoshi/agent-plugin/`
- **Itonami bot profiles (`cloud.itonami.profile.v2`)**: `apps/bengoshi/profiles/`
