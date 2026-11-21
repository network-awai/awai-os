# Itonami Store の入口ページ: Figma デザイン

2026-11-21、[AWAI-3735](https://linear.app/kotobalabs/issue/AWAI-3735)（親 [AWAI-3729](https://linear.app/kotobalabs/issue/AWAI-3729)）。状態: **提案**。

`store.itonami.app` に置く入口ページの画面構成を Figma に作った。[design-first](design-first.md) に沿い、
画面構成の正本は Figma、実装された挙動の証拠は code とする。この文書は deploy も実装の変更も含まない。

## Figma

File `umqCqP5KSjLWh9fhCI1HaN`、page `Itonami Store · Web entry · AWAI-3735`（`903:2`）。
既存の page、component、variable の値は変えていない。

| 画面 | 幅 | 配色 | node |
| --- | --- | --- | --- |
| `/D / Itonami Store` | 1280 | Asa（明） | [903:26](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=903-26) |
| `/M / Itonami Store` | 390 | Asa（明） | [904:180](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=904-180) |
| `/D / Itonami Store · Yoru` | 1280 | Yoru（暗） | [904:415](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=904-415) |
| `/M / Itonami Store · Yoru` | 390 | Yoru（暗） | [904:476](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=904-476) |
| component `Store / App card` | 808 | — | [903:3](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=903-3) |

## 再利用したもの

- 配色: variable collection `Awai Web · Daylight`（background、surface、text、muted、accent、border）。明は Asa、暗は Yoru。
- 余白と角: `Spacing`（xs〜lg）と `Radius`（md、lg）。
- 文字: text style `Awai Web/Display`、`Display mobile`、`Heading`、`Lead`、`Body`、`Label`、`Caption`（Noto Sans JP）。
- 部品: 既存の `Button`（Primary と Secondary）、`Awai / Site logo 02 master`。
- 画面の型: 既存の `Website · responsive UX` page と同じ、1280 と 390 の縦積み、余白 40 と 20。

新しく足したのは local component `Store / App card` だけ。名前、説明、パッケージ、版、大きさ、SHA-256、署名者を
component property で差し替える。一覧の 8 件はすべてこの instance。

## 内容

文言と値は、AWAI-3730 の生成物（署名つき pointer sequence 3、catalog revision 109）と同じ事実に限った。

- 開発版であることの表示。
- 入手のしかた: Awai OS、Android、iPhone・iPad（提供していない）、Mac・Windows・Linux（提供していない）。
- アプリ 8 件。それぞれに取得ボタンと、リンク先の host の表示。
- 取得したファイルの確かめ方。
- このページの根拠（pointer、カタログ、固定した commit、署名者）。

Store 本体の APK、iOS、desktop は公開していないので、入手できるようには描いていない。
ボタンは見本で、Figma は何も取得しない。

## 確認

- 4 画面と component のスクリーンショットを確認した。親からはみ出す text は 0 件。
- 通常幅の画面は text 145、instance 18、画像は logo の 1 件。画面全体を画像で貼ったものは無い。
  （AWAI-3736 で component に行を足す前の数。足した後も、はみ出す text は 0 件。）
- 使われている font は Noto Sans JP の Regular と Medium だけ。

## 実装（`store/site`）との対応（AWAI-3736、2026-11-21）

[AWAI-3736](https://linear.app/kotobalabs/issue/AWAI-3736) で、HTML／CSS を Figma に合わせた。
先に決めていなかった点は、次のように決めて進めた。owner の決定ではなく、作業上の選択である。

| 点 | 選んだこと | 理由 |
| --- | --- | --- |
| アプリの項目 | Figma の component に「外部との通信」の行を足し、版に versionCode、署名者に全桁を出す。発行者の行は実装から外した | 検証に使う情報を残す。発行者は署名者と重なる |
| logo | Figma の `Awai / Site logo 02 master` を 128px の PNG で書き出し、同じ origin に置く。CSP に `img-src 'self'` を足した | 画像は 1 枚で、外部からは読まない |
| font | font ファイルは配らない。`font-family` の先頭に Noto Sans JP を置き、無い端末は端末の font になる | 数 MB の font を配らない。外部の font 配信は使わない |
| 明暗 | OS の明暗の設定で Asa と Yoru を切り替える。Hiru と Yuu は使わない | ページは script を持たない |

### 比べた結果

生成したページをローカルの HTTP server で表示し、Figma の 4 画面と比べた（Chromium、Noto Sans JP が入っている Mac）。

| 項目 | Figma | 実装（計測値） |
| --- | --- | --- |
| 通常幅の列 | 一覧 808、補足 368、間 24 | 一覧 808、補足 368、間 24（幅 1280） |
| 余白 | 通常幅 40、スマホ幅 20 | 40、20 |
| card | 余白 24（スマホ幅 16）、角 12、枠 1 | 24（16）、12px、1px |
| 見出し | Display 48/67、スマホ幅 32/46 | 48px/67px、32px/46px |
| 小見出し | Heading 24/36、500 | 24px/36px、500 |
| 本文 | Body 16/28 | 16px/28px |
| ボタン | 高さ 48、13px | 48px、13px |
| 明の配色 | 背景 #ffffff、面 #f5f6f8、文字 #182332、枠 #9aaabd、強調 #1e50a2 | 同じ値 |
| 暗の配色 | 背景 #14110f、面 #272422、文字 #ffffff、枠 #4f4d4b | 同じ値 |
| スマホ幅の順 | 開発版、入手のしかた、アプリ、確かめ方、根拠、ボタン | 同じ順 |
| 横スクロール | — | 1280 と 390 のどちらも無し |

意図した違い:

- **font。** Noto Sans JP が無い端末では、端末の font で表示される。
- **Secondary ボタンと Primary ボタンの色。** Figma の Button は別の variable（`action/bg`、`bg/raised` など）を使う。
  実装は Daylight の accent、background、border、text で近い色にした。値は読み比べていない。
- **幅 390〜899 の間。** Figma には 1280 と 390 の 2 つしか無い。実装は 900 未満を 1 列にした。
- **ページ全体の高さ。** 文字の折り返しで変わるので、合わせていない。

確かめていないもの: Chromium 以外のブラウザ、Noto Sans JP が無い端末、画面の読み上げ、キーボードだけの操作。

## 残っている点

- **ページが古い場合。** pointer の期限が切れても、script の無いページは自分では気づけない。
  「いつまで有効か」を根拠の欄に書く形にとどめた。古い状態の画面は作っていない。
- **Figma の prototype。** 遷移は付けていない。
