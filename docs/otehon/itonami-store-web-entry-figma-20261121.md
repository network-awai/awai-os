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
- 使われている font は Noto Sans JP の Regular と Medium だけ。

## 実装（`store/site`）との差分

いまの HTML／CSS は Figma より先に書いたので、次の点が違う。直すのは別 issue（[AWAI-3736](https://linear.app/kotobalabs/issue/AWAI-3736)）。

| 点 | Figma | いまの実装 |
| --- | --- | --- |
| 文字 | Noto Sans JP、Awai Web の文字の段階 | system-ui、独自の大きさ |
| 配色 | Awai Web · Daylight の Asa と Yoru | 独自の配色（緑の強調色、黄色の注意書き） |
| 通常幅の構成 | 2 列（一覧 808、補足 368） | 1 列（最大 46rem） |
| 見出し部 | logo と「Itonami Store」「Awai Network」 | logo なし |
| 開発版の表示 | 強調色の枠の card | 黄色の背景と左の線 |
| 取得ボタンと補足 | 既存の Button と、digest を見る Secondary ボタン | 独自のボタンと文中のリンク |
| アプリの項目 | パッケージ、版、大きさ、SHA-256、署名者（短縮） | 加えて発行者、外部との通信の宣言、versionCode、署名者の全桁 |

決めていない点:

- **アプリの項目。** 実装にある「外部との通信の宣言」と署名者の全桁は、検証に使う情報である。Figma に足すか、
  実装から外すかは未決定。提案は、Figma に足す。
- **logo。** 実装の CSP は画像を許していない（`default-src 'none'`）。logo を入れるなら `img-src 'self'` を足すか、
  HTML に SVG を直接書く。
- **font。** Noto Sans JP を配るには font ファイルを同じ origin に置く必要がある。外部の font 配信は使わない。
  端末にある font に任せる場合は、Figma と見た目が変わる。
- **昼と夕の配色。** Daylight には Asa、Hiru、Yuu、Yoru の 4 つがある。ページは script を持たないので、
  時刻では切り替えられない。OS の明暗の設定で Asa と Yoru を切り替える形になる。
- **ページが古い場合。** pointer の期限が切れても、script の無いページは自分では気づけない。
  「いつまで有効か」を根拠の欄に書く形にとどめた。古い状態の画面は作っていない。
