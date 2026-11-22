# Itonami Store を通常の Android に配る計画（2026-11-22、AWAI-3759）

親: AWAI-3732。この文書は、鍵と実機が無くても確かめられたことと、残りの作業の分け方を書く。
鍵の作成、署名、公開、実機検証、Google への登録はしていない。

code の根拠は `network-awai/awai-os` main `f797639d` の file と行。外部の事実は 2026-11-22 に読んだ Google の公開ページ。

## 1. いまの状態（code）

| 項目 | 状態 | 根拠 |
|---|---|---|
| APK の署名 | この Mac の Android debug 鍵（`~/.android/debug.keystore`、別名 `androiddebugkey`、パスワードは既定の `android`）に固定 | `android/build.py:75`、`:160` |
| カタログの署名 | 同じ debug 鍵。SHA256withRSA | `android/SignCatalog.java:8-13`、`android/build.py:331` |
| latest pointer の署名 | 同じ debug 鍵。fingerprint `2507930b…` 以外は拒否 | `android/publish-latest-pointer.py:13`、`:36` |
| Store が信じる鍵 | build 時に APK の asset へ入れた公開鍵 `catalog-key.der`。カタログと pointer の両方をこれで検証する | `Catalog.java:35`、`AutoUpdater.java:68`、`HostActivity.java:220` |
| 掲載 app の署名者 | カタログの `signerSha256` と、取得した APK・導入済み package の署名者を照合 | `Catalog.java:239-248` |
| debug 以外で署名された app | Registry Assoc の 1 件だけ（`2dfd2669…`） | `Catalog.java:18-19`、`:210` |
| Store APK の `debuggable` | `true`。`false` になるのは `--unsigned-home`（Home 専用）だけ | `android/build.py:12`、`:128` |
| `minSdkVersion` / `targetSdkVersion` | 35 / 37。すべての kind で同じ値 | `android/build.py:38` |
| pointer と APK の取得元 | `raw.githubusercontent.com` の `network-awai/awai-os` に固定 | `LatestPointer.java:23-24`、`AutoUpdater.java:147` |
| build の報告 | `signing: local-android-debug-only` | `android/build.py:337` |

ここから言えること:

1. **署名鍵が 1 本で、役割が分かれていない。** APK、カタログ、pointer が同じ debug 鍵。この鍵の秘密部分は開発機にあり、パスワードは公知の既定値。一般配布の信頼の起点には使えない。
2. **鍵を替えると、既存の Store は新しいカタログを受け付けない。** Store は build 時の公開鍵 1 本しか持たず、鍵の更新・失効の仕組みが無い（AWAI-2982）。本番鍵の Store は、debug 鍵の Store とは別の系列になる。Android も、署名者の違う APK での上書き更新を拒否する。
3. **Store APK が debuggable。** 一般配布の build は `debuggable=false` でなければならない。
4. **`minSdkVersion=35` の理由は記録が無い。** 最初の commit（`f8799476`、2026-11-16、AWAI-2977）から 35 で、Store と shared の Java に `SDK_INT` の分岐は無い。下げられる下限は、まだ求めていない。
5. **Store 本体の更新経路は、code から見つけられなかった。** 掲載 app の更新はあるが、Store 自身を更新する経路は未確認。

## 2. Google の開発者確認（一次資料、2026-11-22 確認）

出典の記号:
[G] <https://developer.android.com/developer-verification/guides>、
[D] <https://developer.android.com/developer-verification/guides/distributor-resources>、
[F] <https://developer.android.com/developer-verification/guides/faq>、
[FD] <https://developer.android.com/developer-verification/guides/full-distribution>、
[LD] <https://developer.android.com/developer-verification/guides/limited-distribution>、
[ADC] <https://developer.android.com/developer-verification/guides/android-developer-console>、
[S] <https://support.google.com/android-developer-console/answer/16561738>、
[B] <https://android-developers.googleblog.com/2026/06/android-developer-verification.html>

| 点 | 内容 | 出典 |
|---|---|---|
| 要件 | 認定された Android 端末に app を入れるには、確認済みの開発者がその package を登録していること。入手元を問わない | [G] |
| 対象の端末 | 認定端末で Android 8（API 26）以上。更新は Google Play services 経由で届く | [F]（2026-11-10 更新） |
| いま有効な範囲 | 2026-09-30 から、ブラジル、インドネシア、シンガポール、タイ。対象は「参加している store」からの install だけ | [G] [D] [F] |
| 参加している store | Google Play、Galaxy Store、Honor、OPPO、Xiaomi、Transsion、vivo の 7 つ | [G] [B] [S] |
| それ以外の store と直接の install | [F]（2026-07-15）は、参加 store 以外や sideload には「まだ適用されない」と書く | [F] |
| 全世界 | 2027 年。[D] は「2027 年 1 月に開始」「他の store は 2027 年 3 月までに」、登録の目安を 2027-03-01 とする | [G] [B] [D] |
| Play の外だけで配る開発者 | Android Developer Console で登録する | [G] [ADC] |
| 個人 | 政府発行の写真つき ID と住所の証明、メールと電話番号 | [FD] |
| 組織 | 上に加えて D-U-N-S 番号、Google Search Console で確認した web サイト、組織の公式書類。D-U-N-S の取得は最大 28 日 | [FD] [F] |
| 費用 | Full distribution は 25 米ドル | [F] [S] |
| package の登録 | package 名と、署名鍵の証明書の SHA-256 を入れる。既にある package は、console の出す断片を asset に入れた APK をその秘密鍵で署名して upload する | [ADC] |
| 1 つの package に複数の鍵 | 登録できる | [F]（2026-03-23） |
| 鍵をなくした場合 | その package は登録できない | [F]（2026-03-23） |
| 同じ package 名を別の開発者が持つ場合 | install の過半を持つ鍵が優先。無ければ 50 件以上の鍵。それも無ければ先着 | [ADC] |
| 無料の limited distribution | ID 不要、無料。端末は QR か link で 1 台ずつ承認。上限は 20 台（[LD] だけ 50 台と書く） | [LD] [G] [F] [S] |
| 登録していない app を入れる利用者 | 「advanced flow」: 開発者モードを有効にし、再起動して再認証し、1 回だけ 24 時間待つ。そのあと 7 日間または無期限で許可。警告は残る | [F]（2026-03-23、05-11） |
| ADB | 登録なしで入れられる。待ち時間は無い | [F] |
| 審査の対象 | 開発者が誰かだけ。app の内容や機能は見ない | [F] [S] |

**確かめられなかったこと**

- 第三者の store が PackageInstaller の session で入れる場合に、store 側に追加の義務があるか。どのページにも書いていない。[D] は store 向けに、登録状況を調べる API との連携を勧めている。
- store として「参加」する制度に、後から入れるか。
- debug 鍵で署名した build を登録できるか。
- Google Play services の無い端末、認定されていない端末、custom ROM（Awai OS、LineageOS）。「認定端末」の定義と、Play services 経由の配信からは対象外と読めるが、明記は無い。
- 全世界への適用の日付。ページによって「2027 年」「2027 年 1 月」「2027 年 3 月」と違う。

**Itonami Store にとっての意味（私の解釈）**

- 日本の認定端末では、いまは登録が無くても Store と掲載 app を入れられる、と読める。
- 2027 年に全世界へ広がると、登録していない package は、利用者が 24 時間の待ちを含む手順を踏まない限り入らなくなる。一般配布では、ほぼ使えない。
- 登録は package ごと。Store 本体に加え、掲載する app の package すべてが対象になる（いまのカタログは 8 件。`android/README.md` は local app を 28 件挙げる）。
- 登録には、その package の署名鍵の秘密部分が要る。だから本番の署名鍵を先に決める必要がある。鍵をなくすと登録できない。
- 組織で登録するなら、D-U-N-S の取得に最大 28 日かかる。2027-03-01 を目安にすると、早めに始める必要がある。

## 3. owner の判断と操作が要るもの

| # | 項目 | 選択肢や要るもの |
|---|---|---|
| 1 | 鍵の分け方 | カタログ・pointer の発行鍵と、APK の署名鍵を分けるか。APK の鍵を app ごとにするか、1 本にするか |
| 2 | 鍵の保管と署名の場所 | どこに置き、誰が署名するか。秘密鍵は repo、Linear、agent の記録に入れない |
| 3 | 鍵の更新と失効（AWAI-2982） | Store が複数の発行鍵を持てるようにするか。最初の本番 Store を出す前に決めると、あとの移行が要らない |
| 4 | Google への登録の名義 | 個人か組織か。組織なら D-U-N-S、web サイトの確認、公式書類 |
| 5 | 登録する package | Store 本体と、一般配布する app の範囲 |
| 6 | `minSdkVersion` | 下限を求めた結果（子 issue）を見て決める |
| 7 | 認定端末の実機 | 検証に使う端末 |
| 8 | Store 本体の更新 | Store 自身をどう更新するか（入口ページから取り直すか、Store が自分を更新するか） |

## 4. 作業の分け方（子 issue）

| 単位 | 内容 | owner の判断を待たずに進められるか |
|---|---|---|
| A | build が署名鍵を引数で受け、Store を `debuggable=false` で作れるようにする。秘密の値は引数や log に出さない。使い捨ての鍵で test する | 進められる |
| B | `minSdkVersion` の下限を、使っている API から求める（`platforms/android-35/data/api-versions.xml` との照合） | 進められる |
| C | Play つき emulator（この Mac に API 34 の image がある）で、Store の install・取得・更新・取り消しを確かめる。実機の代わりにはならない | A のあと。`minSdkVersion` が 35 のままだと API 34 の image には入らない |
| D | カタログ・pointer の発行鍵を APK の署名鍵から分け、更新と失効を入れる | 判断 1〜3 のあと |
| E | Android Developer Console への登録と package の登録 | owner の操作。判断 4、5 と本番鍵のあと |
| F | 本番鍵での latest チャネルの運用手順 | D のあと |
| G | 認定端末の実機での検証 | 実機と、A・D のあと |

AWAI-3732 の受け入れ条件（release 署名の Store とカタログを認定端末で install・更新できた記録）は、A、D、G が終わったときに満たされる。

## 5. この文書で確かめていないこと

- build を実際に走らせていない。この Mac には SDK（build-tools 36.1.0、platform 37.0）と JDK 21 があるが、試していない。
- 掲載している Tauri app 側の `minSdkVersion` と署名の設定（各 app の repo）。
- 「未確認」と書いた Google 側の各点。
