# Itonami Store UX: aligned catalog / browse / install / update flow

2026-11-23, [AWAI-4070](https://linear.app/kotobalabs/issue/AWAI-4070)（優先度 2/3、2026-11-23 順序）。状態: **実装済み・未マージ**（PR 作成後 URL を追記）。

AWAI-4072（PC 版 Figma 設計）の worker と重ならないよう、worktree
`~/orca/workspaces/awai-os/awai-4070-itonami-store` と branch
`awai-4070-itonami-store` で作業した（AWAI-4072 側に worktree の claim は無いことを確認済み）。

## 参照

- **Google Play**: 検索（名前＋開発者＋カテゴリ）、カテゴリ chips、行ごとの
  インストール／更新ボタン、詳細ページの版・開発者・サイズ。
- **App Store**: 1 件だけの静かなおすすめ（自動再生・ローテーション無し）、
  下に素のリスト、アプリごとの更新ボタン。
- **quiet-by-design / Figma 241:3（Awai OS Setup Welcome）**: 一度に必要なことだけ、
  緊急感や売り込みを持ち込まない。色・余白・文字は Awai Web Daylight
  （Asa/Yoru、Itonami／Soshiki ページと同一トークン）を使い、Figma の構成は
  AWAI-3735（`umqCqP5KSjLWh9fhCI1HaN`, page `903:2`）の提案を継承する。
  本変更は Figma 自体を変更しない。

## 実装

| 場所 | 変更 |
| --- | --- |
| `android/client/store-ux.js`（新規） | DOM を持たない純粋レイヤ。検索、カテゴリ抽出、おすすめ/リスト分割、取得/更新/開く状態機械、確認画面文言、版の遷移、サイズ、カタログ状態の文面。 |
| `android/client/client.js` | discover（検索＋全カテゴリ chips＋おすすめ 1 件＋行のインライン取得/更新/開く＋署名済みカタログ状態）、detail（取得方法・サイズ・現在版）、review（追加/更新で文言切替、版遷移、確認は必ず人が押す）、library（更新件数はテキストのみ）。 |
| `android/client/client.css` | `.store-row` / `.store-action`（tonal、48px、バッジ無し、プログレスアニメ無し）。 |
| `android/build.py` | 梱包リストに `store-ux.js` を追加。 |
| `store/site/build.mjs` + `style.css` | 入口ページに静かな見出しアンカー（`#apps/#how/#verify/#record`、script 無し）、おすすめ 1 件カード（先頭カタログ、自動再生無し）＋全件リスト、広告/追跡なしの注記。CSP・署名検証・digest 照合は従来どおり。 |

## quiet-by-design（やってないこと）

- バッジ角数字、プロモ／黒塗りボタン、「今だけ」といった緊急性の文言、広告、追跡、通知誘導は入れない。
- 評価スター／ランキングは置かない（カタログに評価データが無いため作らない）。
- サイレントインストールしない。取得・更新は必ず確認画面で人が押してから行う。アプリ側の住み替え（権限追加・新しい通信先）は従来どおり確認を止める。
- Store 内でアニメーションは使わない（Home の雰囲気アニメは対象外）。`prefers-reduced-motion` に従う範囲は従来どおり。
- 通信は人が押した時だけ。catalog 状態の 1 行は「署名済みカタログ revision N（期限まで有効）。リンクを押すまで外部と通信しません。」のみ。

## 検証（実装 head で実行）

- `node --test android/tests/store-ux.test.mjs` — 7 tests pass（検索範囲、カテゴリ抽出 おすすめ先頭、featured 重複なし、状態機械、追加/更新文言、版遷移、文面の静かさ）。
- `node --test store/site/build.test.mjs` — 20 tests pass（署名済み pointer/catalog の照合と拒否ケースは従来どおり）。
- `node store/site/build.mjs --out QA-4070/site`（生成物は commit しない）— sequence 4 / revision 110 / apps 8 / downloads 8 / bytesChecked 8。ページに `#apps #how #verify #record` の 4 anchors、`card app featured` 1 件、各 app id 1 回ずつを確認。

確認していないこと: Android 実機での取得/更新画面の表示、Chromium 以外のブラウザ、読み上げ・キーボード操作、キーリスト更新後の入口ページ再生成。Figma への新しいノード追加は未実施（design-first の方法で proposal を別途作る）。
