# Awai Android OS の上の Home・営・Manimani・dapp: 責任と権限の整理

- 状態: **提案**。この文書は決定を生まない。権限、同意、配布、鍵の保管の契約は変えない。
- 日付: 2026-11-22。追跡: [AWAI-3768](https://linear.app/kotobalabs/issue/AWAI-3768)。
- 確認した revision: `network-awai/awai-os` main `8c39e92c`、`network-awai/network-awai-apex` main（2026-11-22）。
- owner の指示（2026-11-22）: 営の mac app と Awai Android OS が重複して見える。Awai Android OS のアーキテクチャの上で、
  Awai OS の Home、Itonami app、Manimani app などの責任、権限、仕様を整理する。Itonami dapp は Tauri の Android app として
  個別にビルドし、営の中に入る構造ではなくなった。連携は API と MCP を前提にする。
- 読み方: §1 と §2 は main のコードと既存の文書から確認した事実。§3 以降は、owner の指示からの解釈と提案で、違っていれば直す。

## 0. owner の整理（2026-11-22、同日の追記）

最初の版を読んだ owner の指示。太字が指示で、その下は指示からの解釈。違っていれば直す。
この節と §3 以降が食い違う箇所は、この節が優先する。該当する行は書き直してある。

- **Itonami = Hermes Agent と bots に相当する。**
  営は、bot を動かす agent の実行基盤と、その上の bot たち。Hermes Agent が profile ごとに bot を持つのと同じ関係。
- **Manimani = Hermes Agent、bots、ChatGPT の Dots、Muse に相当する。既定の bot で、司令塔で、中心の bot。**
  Manimani は営の上で動く bot の 1 つ。利用者が最初に話す相手で、他の bot や app に仕事を振る。
  bot なので、bot profile を持つ（§4 の 2 はこれで決まり）。営と別の実行基盤は持たない。
- **Awai Home = agent OS の入口。ふつうの Android のホームと違い、agent との対話（リアルタイム音声、会話、テキスト）を中心に、
  OS や app を操作する。スワイプで従来のホームへ移る。固定ウィジェットに近い。Android AOSP のホーム機能を活かす。
  Itonami widget、Manimani widget のような、固定ページ、widget として。**
  Home の最初のページは Manimani との対話。スワイプした先に、app の一覧がある従来のホーム。
  営の bot の様子も、Home の固定ページとして出す。

この整理で、最初の版から変わる点:

| 項目 | 最初の版 | この節の後 |
| --- | --- | --- |
| Manimani の位置 | 営から切り出した独立の app | 営の上の既定の bot。画面は Home の固定ページに出す |
| Home と会話 | Home は会話を持たない | Home の中心が会話。ただし会話の中身（音声、推論、記憶）は Manimani 側が持ち、Home は枠を出す（§3.5） |
| 営の画面 | Bot の管理の app | Bot の管理の app であり、Home の固定ページ（Itonami widget）の提供元でもある |
| OS や app の操作 | どこが持つか未定 | Manimani が対話から行う。実際の操作は Awai OS の層の接点を通す（§4 の 3） |

## 1. 既に決まっていること

| 決定 | 出典 |
| --- | --- |
| Awai OS の製品基盤は Android AOSP。OS の lifecycle、権限、接続、画面ロック、Keystore、更新は AOSP が持つ | [aosp-platform-decision](aosp-platform-decision-20261117.md)、`AGENTS.md`「Product OS direction」 |
| Awai OS UI は Welcome、共通 setup、Home、SystemUI/Settings の統合を持つ | 同上 |
| 営は app のまま。アカウント認証は残し、OS の初回設定の繰り返しは省く | 同上 |
| 営の Core / Apps / System と Manimani の構成は保つ | `AGENTS.md`「Product OS direction」 |
| 製品 repo が source、package ID、リリースを持つ。Awai OS は AOSP 統合、Home、app の発見、Store カタログと署名検証を持つ | [app-ownership](../app-ownership.md) |
| Itonami dapp は bot profile、分散型 wallet、DID を持ち自律的に稼働する。Awai app は bot を持たない Tauri app。どちらも MCP や API の接点を持てる | apex `docs/itonami-dapp-distribution-index.md` §0（JUN-1416） |
| dapp は鍵を持たず、OS の鍵・承認サービスに署名を頼む | apex ADR 0048（Proposed） |
| 外部操作は、宣言したものだけを、操作ごとの同意の後に端末から直接行う。bot の tool 承認とブラウザの同意は別物 | kotoba `app-environment-contract.md` |

## 2. 現状（main のコード）

### 2.1 いまある package

| package | 役割 | 持っている権限と接点 |
| --- | --- | --- |
| `network.awai.home` | HOME role の launcher、app 一覧と起動、時計、予定の表示、設定への入口、アカウント連携 | `READ_AGENDA`（署名）、`INTERNET`（連携 relay の 1 経路）。`HOST_ACCOUNT` を**定義**し、`HostAccountProvider` で営に連携の証明を渡す（`android/build.py:17-23`） |
| `network.awai.store` | 署名つきカタログ、取得ごとの同意、APK の検証、OS の installer | `REQUEST_INSTALL_PACKAGES`。online build だけ `INTERNET` |
| `network.awai.murakumo` | 端末内推論の提供元 | `LOCAL_INFERENCE` を**定義**（署名）（`apps/murakumo/.../AndroidManifest.xml:3`） |
| `network.itonami.app`（営） | Otehon shell を 1 つの APK にしたもの。Core / Apps / System、Manimani、Bot の会話、fleet 表示 | `INTERNET`、`ACCESS_LOCAL_NETWORK`、`RECORD_AUDIO`、画面録画の foreground service、Accessibility service、`LOCAL_INFERENCE`、`HOST_ACCOUNT`（`apps/itonami/.../AndroidManifest.xml:3-37`） |
| `network.awai.gaka`、`network.itonami.*` など | 個別の Tauri app。Store から入れる | app ごと。多くは `INTERNET` なし |

Manimani という package は無い。Manimani は、NixOS の端末内サービス（`otehon/manimani`、`127.0.0.1:8771`）と、
営の shell の中の 1 画面（`otehon/shell/src/shell/manimani.cljs:9`）でできている。Android にはそのサービスが無い。

### 2.2 重複と食い違い

| # | 観測 | 出典 | 何と重なるか |
| --- | --- | --- | --- |
| 1 | 営の初期設定に Network の画面があり、Wi-Fi や Bluetooth を `127.0.0.1:8773` に聞く | `otehon/shell/src/net.js:6` | Android の設定と Awai OS の共通 setup。「OS の初回設定の繰り返しは省く」に反する。Android と macOS では常に「確認できません」 |
| 2 | 営の下部の dock が、端末とノードの状態を `127.0.0.1:8774` などから読む | `otehon/shell/src/status.js:7` | Android の SystemUI と設定。NixOS のサービスが前提 |
| 3 | 営が Accessibility service と画面録画を持ち、ホーム、最近、設定へ移動できる | `apps/itonami/.../AndroidManifest.xml:8,37`、`apps/itonami/src-tauri/src/lib.rs:154`（`awai_screen_tools`） | Home と SystemUI の役割。1 つの app が OS の操作と録画の権限を持っている |
| 4 | 営の sidebar が dapp のカタログを持ち、dapp ごとの会話と信頼スコアの下限を営の中で扱う | `otehon/shell/src/shell/main.cljs:30`、`otehon/shell/index.html:14` | Store と個別の APK。dapp が営の中に入る以前の構造 |
| 5 | Home に「Manimani に相談する」があり、押すと営を起動する | `android/client/client.js:119` | Manimani の入口が Home と営の 2 か所にある |
| 6 | Bot の稼働状況は、同じ場所に置かれた `fleet-state.json` を読む。Tauri の梱包には入っていない | `otehon/shell/src/shell/fleet_overview.cljs:23`、`otehon/shell/src/meiji/client.cljc:13`、`apps/itonami/src-tauri/tauri.conf.json:10` | NixOS ノードの制御側が書き出す静的成果物が前提。Android と macOS では「更新できません」 |
| 7 | Agent との会話の接続先が、特定の tailnet の host に固定されている | `otehon/shell/src/bot-chat-contract.js:1` | 端末や利用者ごとに変わるはずの接続先 |
| 8 | app 間の接点は 2 種類の Android IPC だけ（`LOCAL_INFERENCE`、`HOST_ACCOUNT`）。MCP の実装は awai-os に無い | `android/build.py:19-22`、Murakumo の manifest、`git grep -i mcp`（apps、android、shell、packages で 0 件） | 「API と MCP で連携する」の実体がまだ無い |
| 9 | 営の macOS build は同じ shell を包んだもので、1、2、6 が全部「読めない」になる | [JUN-1430](https://linear.app/kotobalabs/issue/JUN-1430) の記録 | macOS には Awai OS の層（Home、Store、Murakumo、連携の IPC）が無い |

まとめると、営は NixOS の Otehon で「OS の画面そのもの」だった shell を、そのまま app にしたものです。
Android では OS の層を AOSP と Home が持つので、営の中に OS の役割が残り、重複になっています。

## 3. 整理の案

### 3.1 層

```
Android AOSP            OS lifecycle、権限、接続、画面ロック、Keystore、更新
Awai OS（署名つき）      Home（agent との対話が中心の入口） / Store / 鍵・承認サービス / Murakumo（端末内推論）
agent                   営（bot の実行基盤と bot たち）。その既定の bot が Manimani
app                     Itonami dapp・Awai app（個別の APK）。道具を宣言し、agent から呼ばれる
```

Awai OS の層は「同じ署名の package だけが呼べる接点」を定義する側、app の層はそれを使う側、と分けます。

### 3.2 責任と権限

| | Awai OS Home | 営（Itonami） | Manimani | Itonami dapp / Awai app |
| --- | --- | --- | --- | --- |
| ひとことで | agent OS の入口 | bot の実行基盤と bot たち | 既定の bot、司令塔 | 個別の仕事をする app |
| 相当するもの | launcher | Hermes Agent と bots | Hermes Agent の既定 profile、ChatGPT の Dots、Muse | 個別の app |
| 責任 | HOME role。最初のページに対話の枠を出す。スワイプ先に従来のホーム（app の一覧と起動）。setup の続き、設定と Store への入口、アカウント連携の保持と証明 | アカウントでの sign-in、bot の一覧・作成・状態（Soshiki、fleet）、bot の実行、bot ごとの会話と履歴、Agent の外部操作の同意。Home に出す固定ページの中身 | 利用者との対話（リアルタイム音声、会話、テキスト）、記憶、予定された作業、他の bot や app への依頼、OS や app の操作の依頼、したことの記録と一時停止 | それぞれの画面、手順、状態。宣言した操作だけを行う。agent に道具を出す |
| 持つ状態 | setup の段階、連携済みアカウント、既定 HOME、ページの並び | bot の profile と状態、会話の履歴 | 記憶、予定、依頼の規則（ask / auto）、活動記録（営の bot の状態として持つ） | app ごとの利用者データ |
| 持つ権限 | `HOST_ACCOUNT` の定義と提供、`READ_AGENDA`、連携 relay 用の `INTERNET` | `HOST_ACCOUNT` と `LOCAL_INFERENCE` の利用、`RECORD_AUDIO`、Agent への接続に要る `INTERNET` | 営の権限の中で動く。自分の package を持たない | 宣言した外部操作に要る分だけ。多くは `INTERNET` なし |
| 持たないもの | 音声の取得、推論、会話の記憶、bot の管理、利用者データの保存 | OS の設定（Wi-Fi、音、表示）、端末やノードの dock、dapp のカタログ、OS の操作を直接行う権限 | 鍵、OS の設定を直接変える権限、他の app の同意の代行 | 鍵（OS の鍵・承認サービスに頼む）、他の app の同意の代行 |
| 区分（JUN-1416） | Awai OS の一部 | bot たちの実行基盤。bot profile を持つ Itonami dapp の側 | bot。bot profile を持つ。wallet、DID、自律稼働の要件を満たす対象 | 定義どおり |

現状からの移動は次のとおりです。

| いまの場所 | 中身 | 案での行き先 |
| --- | --- | --- |
| 営の初期設定の Network 画面、端末・ノードの dock | OS の状態と設定 | 営から外す。Android の設定と Awai OS の setup に任せる |
| 営の sidebar の dapp カタログ | dapp の一覧と入口 | Home の app 一覧と Store。営には Bot だけ残す |
| 営の中の Manimani 画面 | 既定の bot との対話 | 中身は営のまま。出す場所を Home の最初のページにする（§3.5）。Home の「Manimani に相談する」ボタンは要らなくなる |
| 営の Accessibility service と画面録画 | 画面の操作と記録 | Awai OS の層の接点にして、Manimani は依頼するだけにする案（§4 の 3） |
| 営の `RECORD_AUDIO`、`LOCAL_INFERENCE` | 音声と端末内推論 | 営に残す。Manimani が営の上で使う |
| NixOS の Manimani サービス（8771） | 記憶、予定、依頼 | 営の bot の実行基盤の中へ。先行実装は oracle として残す |

### 3.3 連携: API と MCP

dapp が営の中に入らないので、「どの app が、どの app に、何を頼めるか」を接点として決める必要があります。
いまある 2 つの IPC（Murakumo、Home のアカウント証明）と apex ADR 0048 は、同じ形をしています。
署名で守った接点、閉じた要求の型、呼び出し元の検査、nonce と期限です。この形を一般化するのが素直です。

| 種類 | 誰が出す | 誰が呼ぶ | 例 | 守り方 |
| --- | --- | --- | --- | --- |
| OS の接点（API） | Awai OS の層（Home、Murakumo、鍵・承認サービス） | 同じ署名の app | 連携の証明、端末内推論、署名の依頼 | 署名 permission、閉じた要求の型、nonce、端末ロックの検査 |
| app の道具（MCP） | 各 dapp / Awai app | Manimani、営の Bot | 「予定を読む」「下書きを作る」「画像づくりを開く」 | app が道具を宣言する。呼ぶ側は一覧にある道具だけを呼ぶ。効果のある操作は、呼ばれた側が利用者に同意を求める |
| 外の service | 外部 | 各 app（端末から直接） | relay、モデルの取得、Agent | 既存の descriptor と操作ごとの同意。変えない |

守ること（既存の契約からそのまま）:

- 道具の呼び出しは、利用者の同意の代わりにならない。Manimani や Bot が dapp の道具を呼んでも、
  dapp の外部操作には dapp 自身の操作ごとの同意が要る。逆も同じ。
- 呼ぶ側は、宣言されていない道具を呼べない。道具の返す文章はデータで、指示として扱わない。
- app は鍵を持たない。署名は OS の鍵・承認サービスに頼む。
- 会話の内容を、開くだけの連携に載せない（画家の起動は会話のデータを渡していない。この形を既定にする）。

MCP を端末の中でどう運ぶかは未決定です（§4 の 4）。awai-os には実装が無いので、ここは新しく決める部分です。

### 3.4 macOS

macOS には Awai OS の層が無いので、営の mac build は「Awai Android OS の上の営」と同じものにはなりません。
案は、macOS を**開発と確認のための host** と位置づけることです。製品としての画面は Awai Android OS（phone と PC）に置きます。
mac build を残す場合は、§3.2 の整理が済んだ後の営（Bot の管理だけ）を対象にすると、読めない画面が出なくなります。

### 3.5 Home の固定ページ（Manimani widget、Itonami widget）

Home は自前の launcher（`network.awai.home`、HOME role）で、画面は 1 つの WebView の中のページとして作ってある
（`android/client/client.js:101` の `home()`、`:130` の `drawer()`）。ページの並びは Home が自分で決められる。
「最初のページが対話、スワイプ先が従来のホーム」は、Home の中の変更で作れる。別の launcher は要らない。

Android の「ウィジェット」には 2 つの意味があり、分けて考える必要がある。

| 方式 | できること | この用途に合うか |
| --- | --- | --- |
| AppWidget（ホーム画面に置く標準のウィジェット） | 表示と、押して起動する程度の操作。使える部品が限られ、文字入力欄や WebView は置けない | 合わない。リアルタイム音声や文字での対話は作れない。bot の様子を小さく見せる用途なら使える |
| Home 自身のページとして作る | 何でも描ける。ただし音声の取得と推論を Home が持つことになる | 作りやすいが、Home に `RECORD_AUDIO` と推論が入り、権限が入口に集まる |
| 営が描いた画面を Home のページにはめ込む（`SurfaceControlViewHost`） | 営の process が描き、Home は枠だけ出す。タッチは営に届く | 権限の分離に合う。音声と推論は営のまま。文字入力（IME）とマイクの扱いは実機で確かめる必要がある |

案は 3 つ目。Home は枠と並びを持ち、Manimani の対話と営の bot 一覧は営が描く。
固定ページなので、利用者が外したり他の app が置き換えたりはできない（Home と営は同じ署名で確かめ合う）。
はめ込みが実機で成り立たない場合の次善は 2 つ目で、そのときは Home が持つ権限を文書に明記して増やす。

上の表の Android の挙動（AppWidget の制約、`SurfaceControlViewHost` でのはめ込み）は、一般的な仕様の理解に基づく。
この repo では試していない。着手の最初に、moto g05 と PC で小さな試作をして確かめる。

確かめること:

- はめ込んだ画面で、文字入力と IME が使えるか。
- Home が前面にあるとき、営の側でマイクを取れるか（前面の app ではないので、foreground service の種類と開始条件が関わる）。
- スワイプで従来のホームへ移る操作と、はめ込んだ画面の中のスクロールがぶつからないか。
- 営が落ちたとき、Home が枠の中に「つながっていません」を出し、従来のホームへは移れるか。

## 4. owner が決めること

| # | 決めること | 選択肢 | この文書の案 |
| --- | --- | --- | --- |
| 1 | Manimani を独立した APK にするか | (a) 独立した app にする。(b) 営の上の bot のままにして、画面を Home に出す | **§0 の整理からは (b) と読める。** 確認待ち |
| 2 | Manimani は bot profile、wallet、DID を持つか | (a) 持つ。(b) 持たない | **決定（2026-11-22）: bot である。** wallet、DID、自律稼働の満たし方は別に決める |
| 3 | 画面の操作（ホーム、最近、設定）と画面録画をどこが持つか | (a) 営（Manimani）。(b) Awai OS の層の接点にして、Manimani は依頼するだけ。(c) やめる | (b)。対話から OS を操作する、は §0 で決まり。操作の権限は入口の層に置き、要求の型を閉じる |
| 10 | Home の固定ページの作り方 | §3.5 の 3 方式 | はめ込み。試作で確かめてから決める |
| 4 | MCP を端末内でどう運ぶか | (a) 署名 permission つきの Android IPC に MCP の道具一覧と呼び出しを載せる。(b) loopback の HTTP。(c) 別の方式 | (a)。既存の 2 つの IPC と同じ守り方が使える |
| 5 | 営の Core / Apps / System の構成を変えてよいか | (a) Apps（dapp カタログ）と System（OS の状態）を営から外す。(b) 構成は保ち、中身だけ Android 向けに差し替える | (a)。ただし `AGENTS.md` の「構成を保つ」と食い違うので、決定の更新が要る |
| 6 | Bot の稼働状況をどこから読むか | (a) 配布元の署名つき成果物を、宣言した外部操作として読む。(b) 端末内のサービスから読む。(c) 営に native の接点を足す | (a)。静的配信と操作ごとの同意の契約に合う |
| 7 | Agent の接続先 | (a) 利用者が設定する。(b) アカウントから引く | 未定。固定の host は外す |
| 8 | macOS の位置づけ | (a) 開発と確認の host。(b) 製品として対応する | (a) |
| 9 | Manimani の package ID と owner repo | `network-awai/app-manimani` は既にあるが、中身は以前の Worker 版 | 1 が (b) なら package は要らない。bot profile の置き場所だけ決める |

5 は、既存の accepted な方針と食い違う提案です。黙って進めず、決定を更新してから着手します。

## 5. 決まった後の作業の切り方（参考）

決定ごとに 1 PR で閉じる単位に切れます。順序の案です。

1. 営から OS の画面を外す（Network の設定、端末・ノードの dock）。テストは shell の既存検査。
2. Home の固定ページの試作（§3.5 の確かめること）。結果で方式を決める。
3. Home の最初のページを Manimani との対話にし、スワイプ先を従来のホームにする。Figma を先に作る（design-first）。
4. app の道具の宣言と呼び出しの契約を文書にし、画家と予定で最初の実装をする。
5. 営の sidebar を bot だけにする。dapp の入口は Home と Store に寄せる。
6. Bot の稼働状況の読み先を決めた方式に替える。

1 と 5 は端末が無くてもテストで判定できるので、開発 bot に渡せます。2 は実機が要ります。3 と 4 は設計の決定が先です。

## 6. この文書が変えないもの

- コード、manifest、権限、署名、Store のカタログ。
- 同意の契約、鍵の保管、配布の方式。
- 既存の識別子と package ID。
