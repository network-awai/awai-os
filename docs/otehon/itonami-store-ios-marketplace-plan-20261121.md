# Itonami Store を iOS に出す: 代替マーケットプレイス対応の計画

2026-11-21、[AWAI-3725](https://linear.app/kotobalabs/issue/AWAI-3725)（関連 [AWAI-2975](https://linear.app/kotobalabs/issue/AWAI-2975)、[AWAI-2982](https://linear.app/kotobalabs/issue/AWAI-2982)、[AWAI-179](https://linear.app/kotobalabs/issue/AWAI-179)）。状態: **提案**。

この文書は owner が判断するための材料で、決定を含まない。実装、Apple への申請、契約、支払いは行っていない。
Apple の条件は §8 の一次資料を 2026-11-21 に読んだ記録で、Apple が変更すれば古くなる。申請の前に読み直す。
「未確認」と書いた項目は一次資料で確かめていない。

## 結論

- **いまは iOS の計画が無い。** Itonami GMS 計画の対象は Android、NixOS、Waydroid で、iOS は入っていない（§1）。
- **Android 版 Store は iOS に移せない。** iOS では Apple が各アプリを公証して署名し、インストールは OS の MarketplaceKit が行う。
  Store 自身が APK の digest、package、署名者を検証する現在の設計は、iOS では置き換えになる（§4）。
- **日本で自前のマーケットプレイスを出す道は、いまは 100 万米ドルの信用状だけ。** もう一つの条件（2 年の良好な在籍と年間 100 万件の初回インストール）は満たしていない（§2.2）。
- **EU は入口が広い。** 信用状のほかに財務監査、D&B の評価などで資格を得られる。掲載が自社アプリだけなら、
  マーケットプレイスを作らずに Web Distribution で配れる（§2.1、§3）。
- **マーケットプレイスも Web Distribution も、動的に応答するサーバーが要る。** 静的な配信だけでは成り立たない（§4.1、
  [AWAI-3727](https://linear.app/kotobalabs/issue/AWAI-3727) で確認）。環境契約との関係は owner の判断が要る。
- **推奨: 自前マーケットプレイスの申請はいま決めない。** 先に owner の前提作業（§6）と、費用のかからない試作（§7 の子 issue 1〜3）で
  作業量を測る。Android の一般配布（AWAI-2982）を先に進める。理由は §5。

## 1. 現状

| 項目 | 状態 | 出典 |
| --- | --- | --- |
| Itonami GMS 計画の対象 | Android、NixOS、Waydroid。iOS の記述なし | [itonami-gms-plan-20261116.md](itonami-gms-plan-20261116.md) |
| 配布・掲載の仕様索引 | Awai Android への配布だけを扱う | network-awai-apex `docs/itonami-dapp-distribution-index.md` |
| dapp carrier | iOS を未達として挙げている | [`apps/dapp-carrier/README.md`](../../apps/dapp-carrier/README.md) |
| iOS の app | awai-mobile の Awai app（`network.awai.app`）だけ。通常の App Store 向けで、署名証明書が無く archive は未作成 | awai-mobile `docs/store/README.md`（2026-11-09） |
| Apple の account | Kotoba Labs, Inc. の組織 account。App Store の EU trader status は未対応 | 同上 |
| 掲載アプリの iOS 対応 | `app-itonami-*` に iOS の生成物（`src-tauri/gen/apple`）を持つ repo は無い。Tauri は `3.0.0-alpha.6` | `network-awai/app-itonami-kabi` ほか（2026-11-21 の手元 checkout） |

Android 版 Store の現状は [android/README.md](../../android/README.md) にある。署名は開発用で、本番の publisher 鍵と一般配布は AWAI-2982 に残っている。

## 2. Apple の条件（2026-11-21 確認）

### 2.1 EU

2026-10-01 から、EU の条件は Apple Developer Program License Agreement の Attachment 14 にまとまった。
以前の Alternative Terms Addendum は置き換えられた。

| 項目 | マーケットプレイスの運営 | Web Distribution |
| --- | --- | --- |
| 配れるもの | 他の開発者のアプリと自社アプリ | 自分の developer account のアプリだけ |
| 加入の形 | 組織としての Apple Developer Program 加入 | 「Your organization must」と書かれている |
| 資格（どれか一つ） | 下の 7 つ | 同じ 7 つ |
| 最低 OS | iOS 17.4、iPadOS 18 | iOS 17.5、iPadOS 18 |
| 入手の経路 | 運営者の Web サイトからマーケットプレイス app を入れる | App Store Connect に登録した自分の domain から入れる |
| Apple への支払い | 有料アプリとデジタル商品の売上に Core Technology Commission 5% | 同じく 5% |
| 公証 | 配るアプリは公証が要る | 公証が要る |

資格の 7 つ:

1. Developer Program の会費免除を受けた非営利団体、教育機関、政府機関。
2. D&B の GBR 評価が「Low Risk」か「Below Average Risk」。
3. 上場企業か、その企業グループ（WFE 加盟の取引所か Euronext）。
4. 指定の一覧（Midas List、Invest Europe など）に載るベンチャーキャピタルからの出資。金額の下限は無い。
5. 100 万米ドル（か現地通貨の相当額）の stand-by letter of credit。発行元は S&P、Fitch、Moody's のいずれかで BBB- 以上。配布開始から 6 か月以上維持する。
6. 3 年以内の財務監査で、無限定適正意見を受けている。
7. 2 年以上続けて良好な在籍で、前年に全世界で 100 万件を超える初回年間インストールのあるアプリを持つ。

その他:

- EU 域内の法人や拠点は要らなくなった（「Changes for apps in the European Union」）。
- entitlement は開発用と配布用に分かれる。開発用は申請後まもなく付与され、Xcode での build と検証に使える。配布用は資格の審査がある。
- 運営者は、内容の方針と審査、不正や悪意あるアプリの監視、データ収集の方針の公開、政府などからの削除要請への対応、
  知的財産の紛争の手続き、利用者と開発者の支援、Apple への取引の報告を担う。不正、支払い、返金の問題を Apple は扱わない。
- マーケットプレイスの利用料や購読料にかかる 5% は、直近 12 か月の全世界の売上が 1,000 万ユーロ未満で、
  その EU での利用料の累計が 100 万ユーロ未満なら免除される。
- インストール 1 件ごとの料金（以前の Core Technology Fee）は、読んだページに記載が無い。廃止されたかは **未確認**。
- 無料アプリだけを配る場合に Apple への支払いが 0 になるかは、ページに明記が無く **未確認**。

### 2.2 日本

iOS 26.2 から、代替マーケットプレイスでの配布と運営ができる。根拠はスマホ新法（Mobile Software Competition Act）への対応。

| 項目 | 内容 |
| --- | --- |
| 加入の形 | 組織としての Apple Developer Program 加入 |
| 資格（どちらか一つ） | (a) 100 万米ドルの stand-by letter of credit（BBB- 以上、配布開始から 6 か月以上維持）。(b) 2 年以上続けて良好な在籍で、前年に全世界で 100 万件を超える初回年間インストールのあるアプリを持つ |
| EU にある他の資格 | D&B、上場、ベンチャー出資、財務監査、会費免除は、日本のページに無い |
| Web Distribution | 日本のページに記載が無い |
| 最低 OS | iOS 26.2。iPadOS の記載は無い |
| Apple への支払い | 運営者と掲載する開発者の取引に Core Technology Commission 5% |
| 運営者の義務 | EU とほぼ同じ。方針に合うアプリを受け入れることが書かれている |
| 他地域の承認 | EU やブラジルの承認は日本に引き継がれない。信用状は出し直さなくてよい |

### 2.3 その他の地域

ブラジルは iOS 26.5 から。資格は日本と同じ 2 つ。ほかの地域は調べていない（**未確認**）。

### 2.4 共通の仕組み

- 公証は配布経路に関係なく全アプリに行われる基本審査で、正確さ、動作、安全、セキュリティ、プライバシーを見る。
- 代替配布のアプリは Apple が暗号化して署名する。インストール時に、改ざんが無いことと、認可された経路からの
  インストールであることが確かめられる。
- 既知のマルウェアが見つかったアプリは起動できなくなる。
- マーケットプレイス app は MarketplaceKit を使う。App Store Connect で app の記録を作り、掲載する開発者に
  marketplace token を渡し、自分の Web サイトを登録し、公証に出す。TestFlight は内部テストだけ使える。

## 3. 選択肢

| 選択肢 | 使える地域 | 資格と費用 | 掲載できるもの | 未解決の点 |
| --- | --- | --- | --- | --- |
| A. 自前のマーケットプレイス app | EU、日本、ブラジル（地域ごとに申請） | 日本とブラジルは信用状 100 万米ドルが事実上の条件。EU は財務監査や D&B でも可。運営の義務を負う | 自社と他社のアプリ | 配布用のサーバーの運用（§4.1）、運営体制、信用状の調達 |
| B. Web Distribution | EU だけ | EU の 7 つの資格のどれか。売上に 5% | 自社 account のアプリだけ | 認証、license、app データの各サーバーが要る（§4.1）。他社のアプリは載せられない |
| C. 既存の代替マーケットプレイスに掲載 | そのマーケットプレイスが動く地域 | 自社は運営資格が要らない。条件は相手による | 自社のアプリ | 候補と条件は **未確認** |
| D. 通常の App Store | 全地域 | 既存の組織 account で出せる。審査を受ける | 自社のアプリを 1 本ずつ | 似たアプリを多数出す場合の審査上の扱いは **未確認**。Store 自体は出せない見込み（**未確認**） |
| E. Web（PWA） | 全地域 | Apple の資格は要らない | 静的な Web app | native の鍵の保管が使えない。iOS での制限は **未確認** |

Itonami Store に載っているのは、いまはすべて自社のアプリ（`network.itonami.*` と `network.awai.*`）である。
他社のアプリを載せる予定が無いあいだは、A を選ぶ理由は「日本で Store という形を持つこと」に限られる。

## 4. 既存の設計との対応

| Android 版の設計 | iOS で起きること | 判断が要る点 |
| --- | --- | --- |
| Store が APK の digest、package、署名者を検証する | バイナリの信頼の根は Apple の公証と署名になる。Store はバイナリを自分で検証しない | 署名つきカタログを、掲載情報の認証だけに使う形で残すか |
| 本番の publisher 鍵、更新、失効（AWAI-2982） | iOS のバイナリには効かない。カタログの認証に限れば使える | Android と iOS で鍵の役割が違うことを契約に書く |
| PackageInstaller と OS の確認ダイアログ | MarketplaceKit と iOS の確認画面になる | Store の native 確認を iOS でどう置くか |
| 取得は commit 固定の HTTPS の不変バイト | 運営者のサーバーが要る。Apple から配布物を受け取り、端末の要求ごとに配布物、license、検証用の token を返す（§4.1） | app origin ではなく配布基盤として別の役割に置くか。環境契約との関係は owner が決める |
| 取得ごとの同意（canonical broker、each-operation） | WebView の中の取得操作には同じ broker を使える | iOS の確認画面は Kotoba の操作同意の代わりにならない。両方を残す |
| `INTERNET` 権限の無いアプリは OS が通信を止める | iOS にはインストール時の通信権限が無い。同じ保証は成り立たない | 「通信しない」をどう示すか（CSP と公証だけになる） |
| 自動更新の適格判定（AWAI-3653） | OS が運営者の updates endpoint を最大で 24 時間に 1 回呼ぶ。利用者の操作か、自動更新が有効なときに更新される | 同じ方針をどこまで適用できるか。更新の可否は OS の設定が決める |
| app origin は静的配信だけ | 静的配信で成り立つのは E だけ。A と B は動的な endpoint が要る（§4.1） | 同上 |

iOS で成り立たないもの: Store 自身によるバイナリの検証、`INTERNET` 権限による通信の遮断、publisher 鍵によるバイナリの失効、静的配信だけでの配布。

### 4.1 MarketplaceKit の仕組み（2026-11-21 確認、AWAI-3727）

出典は §8 の MarketplaceKit の技術文書。

**マーケットプレイスの構成。** Apple の文書は、構成を「app、その app を入れる Web ページ、App Store Connect から
定期的に受け取る app データを保存する Web サーバー」と書いている。サーバーの役割は次のとおり。

| 役割 | 内容 |
| --- | --- |
| 通知の受信 | App Store Connect からの webhook を受ける endpoint。署名は `x-apple-signature` header の HMAC。通知は、新しい配布物が出た、版が使えなくなった、app が使えなくなった、の 3 種。重複して届くことがある |
| 配布物の取り込み | 公証の後、Apple が alternative distribution package（ADP）を用意する。運営者が App Store Connect API で取得し、自分のサーバーに保存して配る。中身は暗号化されている |
| 端末への応答 | `/.well-known/marketplace-kit` に restore と updates の endpoint を書く。HTTPS、有効な証明書、redirect なし |
| license の発行 | インストールごとに動的な license を発行する。Apple の App License Delivery SDK を Swift のサーバーに組み込む |
| 検証用の token | インストールと更新のたびに、alternative distribution key で署名した install verification token（ES256）を返す |
| 認証 | 必須ではない。ダウンロードを制限する場合だけ認証サービスを置く。復元時の再認証は OAuth 2.0 に沿う |

**開発者から運営者への流れ。** 運営者が開発者に marketplace token を渡し、開発者が App Store Connect に登録する。
開発者が公証に出すと、運営者のサーバーに通知が届く。

**取り下げと失効。** 開発者が販売をやめたとき、または Apple が取り下げを求めたときに、通知が運営者のサーバーに届く。
運営者は配布物を外し、以後の要求に「使えない」と返す。入れ済みの app が端末から消えるかは、読んだ範囲に記載が無い（**未確認**）。

**復元。** 端末を復元すると、マーケットプレイス app とそこから入れた app は暗い placeholder になり、OS が restore の endpoint を呼ぶ。

**Web Distribution。** 自社の app だけを配る場合も、文書は認証、license、app データの 3 種のサーバーを挙げ、
それぞれに 2 つ以上の endpoint があると書いている。license と検証用の token は要求ごとに作る。
静的に置けるのは配布物と `.well-known` の JSON だけである。domain と鍵は App Store Connect API で登録する。
Web ページは、利用者がボタンを押したときだけインストールを始められる。

**entitlement。** マーケットプレイス app の key は `com.apple.developer.marketplace.app-installation`（iOS 17.4、iPadOS 17.4 以降）。
Enterprise 配布と Developer ID 配布の app には使えない。

**検証の環境。** 開発用署名のマーケットプレイス app は Simulator と実機で動かせる。app のインストールは実機で示されている。
App Store Connect への提出を含む手順（内部 TestFlight、Web Distribution）は、対象地域にある端末で行う必要がある。
日本は iOS 26.2 以降で、app は iPhone に対応している必要がある。

**環境契約との関係（事実だけ）。** Kotoba end-user app の環境契約は、app origin に要求時の処理を置かないと定めている。
上のサーバーは、利用者ごとの license と token を要求時に作る。これを app origin に置けば契約に反する。
契約は「静的な配信」と「build／release の基盤」を別の役割として分けているので、配布基盤として別に置く読み方はあり得るが、
契約の本文はマーケットプレイスの配布サーバーを扱っていない。どちらに当たるかは owner が決める。

## 5. 推奨と理由

推奨は次の順。どれも owner の判断の後に進める。

1. **前提作業を済ませる（§6）。** EU trader status は App Store の掲載にも要る。
2. **費用のかからない試作で測る。** 開発用 entitlement の申請と、アプリ 1 本の iOS build（§7 の 1〜3）。
3. **EU は B（Web Distribution）を第一候補にする。** 掲載が自社アプリだけなら条件に合い、運営者の義務も小さい。
   ただし A と同じく動的なサーバーが要る（§4.1）ので、静的配信だけでは済まない。
   資格は財務監査か D&B の評価で得られるかを先に確かめる。
4. **日本は A を保留する。** 信用状 100 万米ドルの調達を決めるまでは、D（App Store に 1 本ずつ）と E（Web）で届ける。
5. **Android の一般配布（AWAI-2982）を先に進める。** 本番鍵とカタログの認証は iOS でも使う部分で、先に固まる。

理由:

- 日本の資格は 2 つだけで、いま満たせるのは信用状だけである。額が大きく、owner の判断が要る。
- 他社のアプリを載せないあいだは、マーケットプレイスの運営義務（審査、不正の監視、削除要請、支援）に見合う利点が小さい。
- 掲載アプリはどれも iOS の build をまだ持たない。どの選択肢でも、アプリごとの iOS 対応が先に要る。

この推奨は、他社のアプリを載せる方針が決まった場合、または Apple が日本の資格を広げた場合に見直す。

## 6. owner の作業（前提）

| 作業 | 要る場面 | 状態 |
| --- | --- | --- |
| App Store の EU trader status を登録する | EU での掲載すべて | 未対応（awai-mobile の記録） |
| 最新の Apple Developer Program License Agreement に同意する（Attachment 14、日本向けの条項） | 全選択肢 | **未確認** |
| Kotoba Labs の署名証明書を build 用の Mac に入れる | iOS の build すべて | 無い（awai-mobile の記録） |
| Apple Developer Program の加入日を確かめる | 「2 年の良好な在籍」の起算 | **不明** |
| 開発用の Alternative App Marketplace Entitlement を申請する | A の試作 | 未申請 |
| EU の資格をどれで満たすか決める（財務監査、D&B、信用状） | A と B の配布 | 未決定 |
| 日本の信用状 100 万米ドルを調達するか決める | 日本での A | 未決定 |
| 他社のアプリを載せるか決める | A と B の選択 | 未決定 |
| マーケットプレイスの運営体制（審査、削除要請、支援の窓口）を決める | A | 未決定 |

## 7. 実装に進む場合の子 issue 案

1 件が 1 つの PR で終わる単位。番号は順序の案で、起票はしていない。

1. Tauri v3 の iOS target を 1 本のアプリ（例: `network.itonami.kabi`）で build し、simulator で起動する。必要な手順と時間を記録する。
   → [AWAI-3728](https://linear.app/kotobalabs/issue/AWAI-3728) として起票した。
2. MarketplaceKit の文書を読み、配布物の受け渡しにサーバーが要るか、更新と失効の仕組みを §4 の表に書き足す（文書だけ）。
   → [AWAI-3727](https://linear.app/kotobalabs/issue/AWAI-3727) で実施し、§4.1 に書いた。
3. 開発用 entitlement で、アプリ一覧を出すだけの marketplace app を試作する（owner が entitlement を申請した後）。
4. 署名つきカタログの schema に、iOS の掲載情報（bundle ID、公証済みの版）を足す案を `.cljc` の契約とテストで書く。
5. Web Distribution 用の静的な一覧ページを、既存の `export-web.py` の出力から作る試作（EU の資格が決まった後）。
6. アプリごとの iOS 対応の一覧を作る（bundle ID、権限、外部操作の宣言、build の可否）。
7. iOS 版の検証記録の形式を決める（source、build、simulator、実機、公証を分けて記録する）。

## 8. 一次資料（2026-11-21 に確認）

- [Operating an alternative app marketplace in the EU](https://developer.apple.com/support/alternative-app-marketplace-in-the-eu/)
- [Changes for apps in the European Union](https://developer.apple.com/support/apps-in-the-eu/)
- [Web Distribution in the EU](https://developer.apple.com/support/web-distribution-eu/)
- [Operating an alternative app marketplace in Japan](https://developer.apple.com/support/alternative-app-marketplace-jp/)
- [Changes to iOS in Japan](https://developer.apple.com/support/app-distribution-in-japan/)
- [Operating an alternative app marketplace in Brazil](https://developer.apple.com/support/alternative-app-marketplace-br/)
- [Create a marketplace app（App Store Connect Help）](https://developer.apple.com/help/app-store-connect/distributing-apps-in-the-european-union/create-an-marketplace-app)

MarketplaceKit の技術文書（AWAI-3727、2026-11-21 に確認。HTML は本文を返さないため、同じ文書の JSON 形式を読んだ）:

- [Creating an alternative app marketplace](https://developer.apple.com/documentation/marketplacekit/creating-an-alternative-app-marketplace)
- [Processing alternative marketplace notifications](https://developer.apple.com/documentation/marketplacekit/processing-alternative-marketplace-notifications)
- [Ingesting an alternative distribution package](https://developer.apple.com/documentation/marketplacekit/ingesting-an-alternative-distribution-package)
- [Installing apps from an alternative marketplace](https://developer.apple.com/documentation/marketplacekit/installing-apps-from-an-alternative-marketplace)
- [Installing your app from your website](https://developer.apple.com/documentation/marketplacekit/installing-your-app-from-your-website)
- [Distributing your app from your website](https://developer.apple.com/documentation/marketplacekit/distributing-your-app-from-your-website)
- [Distributing your app on an alternative marketplace](https://developer.apple.com/documentation/marketplacekit/distributing-your-app-on-an-alternative-marketplace)
- [Participating in alternative distribution for specific regions](https://developer.apple.com/documentation/marketplacekit/participating-in-alternative-distribution-for-specific-regions)
- [Reauthenticating a person to manage apps](https://developer.apple.com/documentation/marketplacekit/reauthenticating-a-person-to-manage-apps)
- [Supplying an install verification token](https://developer.apple.com/documentation/marketplacekit/supplying-an-install-verification-token)
- [com.apple.developer.marketplace.app-installation](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.marketplace.app-installation)

確認の限界:

- ページは要約を介して読んだ。数値と条件は引用で確かめたが、契約本文（License Agreement の Attachment 14 と日本向けの条項）は読んでいない。
- App Store Connect Help のページは、手順の部分が要約だけで、文言は確かめていない。
- entitlement は、申請ページでは「Alternative App Marketplace Entitlement」と呼ばれ、key は
  `com.apple.developer.marketplace.app-installation` である（§4.1）。
- MarketplaceKit の文書のうち、鍵の作成と接続の確立、App License Delivery SDK、Core Technology Commission の取引報告、
  App Store Connect API の各 endpoint のページは読んでいない。webhook の登録 API は文書の metadata で deprecated と
  なっており、後継は **未確認**。
- EU のページは Initial Acquisition Fee と Store Services Fee を廃止したと書く一方で、「Store services commission」の料率を載せている。
  App Store の外で配る場合には関係しないが、読み違いの可能性がある。
- Tauri v3 の iOS 対応、App Review Guidelines は読んでいない。

これらのページは変わる。設計の根拠であって、申請時点の条件の証明ではない。
