# Awai Home の固定ページ: Figma デザイン

2026-11-22、[AWAI-3773](https://linear.app/kotobalabs/issue/AWAI-3773)（親 [AWAI-3770](https://linear.app/kotobalabs/issue/AWAI-3770)）。状態: **提案**。

owner の指示（2026-11-22）: Awai Home は agent OS の入口。agent との対話（リアルタイム音声、会話、テキスト）を中心に
OS や app を操作する。スワイプで従来のホームへ移る。Itonami widget、Manimani widget のような固定ページ。
[design-first](design-first.md) に沿い、画面構成の正本は Figma、実装された挙動の証拠は code とする。
この文書は実装も APK も含まない。責任と権限の整理は [home-itonami-manimani-responsibilities-20261122.md](home-itonami-manimani-responsibilities-20261122.md)。

## Figma

File `umqCqP5KSjLWh9fhCI1HaN`、page `Awai OS · 会話がホーム · JUN-1388`（`908:216`）の下段に足した。
この page には、JUN-1388 で作った「会話がホーム」の画面（新規、続き、アプリ一覧、会話履歴、依頼から画家まで）が既にある。
同じ画面は作り直していない。既存の frame、component、variable の値は変えていない。

| 画面 | 大きさ | node |
| --- | --- | --- |
| `Home · Manimani · 待機` | 411 × 917 | [917:89](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=917-89) |
| `Home · Manimani · 聞き取り中` | 411 × 917 | [917:138](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=917-138) |
| `Home · Manimani · 操作の確認` | 411 × 917 | [917:200](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=917-200) |
| `Home · 営 · bot の様子` | 411 × 917 | [917:260](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=917-260) |
| `Home · 従来のホーム` | 411 × 917 | [917:330](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=917-330) |
| component set `Home / ページ位置`（3 variant） | — | [917:76](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=917-76) |
| component `Home / Bot row` | 363 × 68 | [917:77](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=917-77) |
| component `Home / App icon` | 76 幅 | [917:85](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=917-85) |
| 読み方の注記 | 1796 幅 | [917:395](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=917-395) |

## 画面の考え方

- Home は 3 つの固定ページを持つ。並びは **営 ← Manimani（既定）→ ホーム**。起動先は中央の Manimani。
  どちらへも 1 回のスワイプで届く。下の表示（`Home / ページ位置`）が今の位置を示す。
- **Manimani のページ**: 大きな「押して話す」と、その下の文字入力。待機中は依頼の例を 3 つ出す。
  聞き取り中は、確定前の文字と波形を出し、「押して止める」と「入力に切り替える」を置く。
- **操作の確認**: 設定やアプリを変える依頼は、実行の前に操作、対象、接続先、範囲（今回の 1 回だけ）を出す。
  「やめる」と「許可して実行」。やめた場合は何も変えない。許可は次の操作に引き継がない。
- **営のページ**: bot の数（稼働中、待機、確認待ち）と bot の一覧。作成と設定は「営を開く」から営で行う。
- **従来のホーム**: 日付と時計、次の予定、app の一覧、端末の検索。

JUN-1388 の画面は、下部の「会話 / アプリ」の切り替えで行き来する。この段は、その切り替えをページ送りに置き換える案。
どちらを採るかは未決定で、既存の画面は残してある。

## 再利用したもの

- 配色: variable collection `Awai Android v2 · semantic`（background、surface、text、muted、primary、onPrimary、container、onContainer、border）。
  色の直書きは無い。
- 文字: Noto Sans JP の Regular と Bold。大きさは同じ page の既存画面に合わせた（12、13、15、16、22、27）。
- 画面の型: 同じ page の 411 × 917、余白 24。
- icon: マイク、停止、送信、キーボード、検索、履歴の 6 つは、この page 用に描いた vector。

新しく足した component は 3 つ。`Home / ページ位置` は位置ごとの variant、`Home / Bot row` と `Home / App icon` は
文字を property で差し替える。

## 実装との境界

- Figma は音声の取得、推論、設定の変更、同意を実行しない。ボタンは見本。
- bot の名前と数、予定、接続先（Awai-5G）、時刻は見本の値。実際の bot や端末の状態ではない。
- Manimani のページを Home 自身が描くか、営の画面をはめ込むかは未決定（責任の整理の §3.5）。
  はめ込む場合の文字入力とマイクの扱いは実機で確かめていない。
- OS の操作をどの層が実行するか、要求の型をどう閉じるかは未決定（同 §4 の 3）。
  この画面は「確認を出す」ことだけを決めている。
- 3 ページの並びと、利用者がページを外せないことは、この文書の案。
- desktop（PC）の配置、360 dp 幅、Yoru の配色、IME を出したときの配置は描いていない。

## 確認

- 5 画面のスクリーンショットを見た。重なりと切れた文字は見つからなかった。
- 親からはみ出す text は 5 画面とも 0 件。画像の fill は 0 件（画面全体を画像で貼っていない）。
- 5 画面の合計は text 112、instance 17。使われている font は Noto Sans JP だけ。
- 見た目の確認は設計の確認で、Android の実行時の確認ではない。切り欠き、IME、大きな文字の設定、TalkBack、
  実機のスワイプとスクロールの衝突は実装のときに確かめる。

## 次の作業

1. 3 ページの並びと、「会話 / アプリ」の切り替えを置き換えるかを決める。
2. Home の固定ページの試作（責任の整理の §3.5 の確かめること）。
3. 決まった方式で Home を実装する。
