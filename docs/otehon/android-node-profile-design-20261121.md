# Awai Android を node にする: node プロファイルの設計

2026-11-21、[AWAI-3711](https://linear.app/kotobalabs/issue/AWAI-3711)（親 [AWAI-3710](https://linear.app/kotobalabs/issue/AWAI-3710)）。状態: **提案**。
「owner 決定」と書いた項目だけが決定済みで、ほかは未決定。この文書は設計と現状の記録であり、
image、実機、node の設定、鍵を変更しない。

## 結論

- **owner 決定（2026-11-21）: Awai Android を node にもする。** 公開の入口と IPFS の保持を、Android の上で担えるようにする。
- **owner 決定（2026-11-21）: 方式は A。** 入口と保持の機能を、OS image の中の native な常駐サービスとして、
  起動時から動かす。app として動かす案と、Android の中で Linux を動かす案は採らない。
- **owner 決定（2026-11-21）: 常駐サービスは自前で作る。保存は Awai Drive の同期で node 間に持つ。遠隔から管理できるようにする。
  Xavier も Android にする。node プロファイルは Awai Android の中で選ぶ。** 詳細と、それぞれに残る課題は §7。
- いまの awai-os では、まだ node として使えない。永続インストールが未認定で、Jetson 向けの対応が無い（§2）。
- node の機能は「node プロファイル」として分け、明示して選んだ機体だけで有効にする。利用者の端末に入れた OS が、
  公開の配信を勝手に始めないようにするため（§3）。
- 名前の面（`{name}.itonami.app`）の公開は、この作業を待たない。当面は Linux の node で進める。
  配る内容は CID で決まるので、あとから配信元を Android の node に替えても app は変わらない。

## 1. いまの node がしていること

出典は `cloud-itonami/app-itonami-yataverse-distribution` の `deploy/` と README、
および `network-awai/network-awai-apex` の `docs/itonami-domain-unification-design.md` §8.5。

| 役割 | いまの実装（Linux） |
|---|---|
| 入口 | Nginx が公開の 80／443 を受ける。GET と HEAD だけ許可し、回数と同時接続を制限 |
| 保持と配信 | Kubo（IPFS）の gateway（loopback）へ Nginx が渡す。名前ごとに IPNS 名を固定 |
| 更新の追随 | IPNS を追って pin し直す timer |
| 証明書 | Let's Encrypt（HTTP-01）。片方の node で取得し、もう片方へ写す |
| 引き取り | 主の node が落ちたとき、待機の node がルーターの転送を引き取る |
| 管理 | SSH と tailnet |

2026-11-21 の実測では、この入口は応答していない（主の node が offline）。

## 2. いまの awai-os でできること、できないこと

| 項目 | 現状 | 根拠 |
|---|---|---|
| PC での起動 | x86_64 の PC で、RAM 上の Live 起動まで。`/data` は tmpfs で、再起動で消える | [android/desktop/aosp-architecture.md](../../android/desktop/aosp-architecture.md) |
| 永続インストール | **未認定**。NVMe へのインストール、試用後の既存 OS の起動、データの耐久性は確かめていない | 同上 |
| image | 開発用。第三者の Generic x86_64 Live image に Awai の app を足して署名し直したもので、Awai OS のリリースではない | [android/desktop/derived-image/README.md](../../android/desktop/derived-image/README.md) |
| 自前の image、OTA | 未完 | AWAI-3060、AWAI-3061 |
| ARM の PC／ボード | 対応の記述が無い。VM の受け入れテストは ARM のみの VM を拒否する | [android/desktop/README.md](../../android/desktop/README.md) |
| 常駐の配信 | 無い。dapp carrier の受信は前面サービスで最長 6 時間、再起動後は再開しない | [apps/dapp-carrier/README.md](../../apps/dapp-carrier/README.md) |
| debug／管理の経路 | 製品としての設計は提案段階。出荷 image は ADB を既定で無効にする（owner 決定 2026-11-21） | [android-debug-routes-design-20261121.md](android-debug-routes-design-20261121.md) |

機体について:

- **gad**: Linux で Kubo を動かしている。CPU のアーキテクチャと機種は未確認。
- **Xavier**: NVIDIA Jetson（ARM64）。Jetson のどのモデルかは未確認。
  2026-11-21 に調べた範囲では、LineageOS の公式の対応機種に Jetson TX2 NX、TX1、Nano 2GB はあるが、
  Xavier NX は有志の preview、AGX Xavier は見つからなかった（[LineageOS wiki](https://wiki.lineageos.org/devices/quill/build/variant2/)、
  [NVIDIA forum](https://forums.developer.nvidia.com/t/preview-lineage-android-os-for-the-xavier-nx/193857)）。
  Jetson で Awai Android を動かせるかは、モデルを確かめてから判断する。

## 3. 役割を分ける

共有の規則（Kotoba end-user app の環境契約）は、利用者の app、静的配信、プロトコルサービス、
Bot fleet の hosting を別の役割としている。Android を node にしても、この区別は変えない。

| | 利用者の端末（既定） | node プロファイル |
|---|---|---|
| 有効になる条件 | 何もしなければこちら | 機体の持ち主が明示して選ぶ。setup の途中や app から黙って切り替わらない |
| 公開の受け口 | 開かない | 80／443 を受ける |
| 保持するもの | 自分のデータ | 公開してよいと決めた CID だけ。許可した名前の一覧に無いものは返さない |
| 画面 | Home、Store、Itonami | 画面なしで動く。状態は管理の経路から見る |
| 権限 | 通常の app | OS の常駐サービス。app からは操作できない |

- node プロファイルは、app の同意の仕組みとは別物である。公開の配信を引き受けるのは機体の持ち主の決定で、
  ブラウザの操作ごとの同意の対象ではない。逆に、node であることは、その機体の上の app に権限を足さない。
- 非公開のデータを公開の IPFS に平文で pin しない（ADR-2609261200 と同じ）。

## 4. 方式 A の構成（owner 決定）

入口と保持を、OS image の中の native な常駐サービスにする。

| 部品 | 置き方 | いまの node との対応 |
|---|---|---|
| 保持（IPFS の block の保存と pin） | OS の常駐サービス。起動時に init が上げる | Kubo |
| 入口（HTTPS の受け口） | OS の常駐サービス。loopback の gateway に渡すだけで、app のロジックは持たない | Nginx |
| 更新の追随 | 常駐サービスの中の定期処理 | IPNS を追う timer |
| 証明書の取得と更新 | 常駐サービス。鍵は OS の鍵保管に置く | Certbot と node 間の写し |
| 許可する名前の一覧 | 署名つきの設定。一覧に無い名前は 404 | `/etc/nginx/yataverse-apps.map` |
| 管理 | debug 経路の設計に合わせる。ADB を network に開けない | SSH |

採らなかった案:

- **app として動かす**: 通常の app は 1024 未満の port を開けず、長時間の常駐にも制限がある。
- **Android の中で Linux を動かす**: いまの構成を流用できるが、機体の対応に依存し、層が増える。

**実装は自前の常駐サービスにする（owner 決定 2026-11-21）。** 既存の Kubo と Nginx は同梱しない。
出発点は、Tauri の host にある libp2p と CID 検証つきの保存（`apps/dapp-carrier`）。入口（HTTPS の受け口、
証明書、許可する名前の一覧）は新しく作る部分になる。

## 5. Android 特有の制約と、対処の方針

| 制約 | 対処の方針 | 状態 |
|---|---|---|
| 再起動後、画面ロックを解除するまで利用者の領域が読めない | node の常駐サービスは、解除前から読める領域（device-encrypted）だけで動く。公開の block は秘密ではないので、そこに置く。証明書の秘密鍵は OS の鍵保管に置く | 提案 |
| 省電力による停止 | OS の特権サービスとして、Doze と app の待機の対象から外す。node プロファイルのときだけ | 提案 |
| 1024 未満の port | init が上げる常駐サービスに、必要な capability だけを与える。SELinux の policy で範囲を絞る | 提案 |
| 大きな保存領域 | Awai Drive の同期で node 間に持つ（owner 決定）。いまの Drive の経路は 1 ファイル 8 MiB・合計 64 MiB の上限があり、node の規模には足りない（§7 の 3） | 決定。実現には Drive 側の作業が要る |
| ルーターの転送 | いまの UPnP と引き取りの仕組みに当たるものを、常駐サービスに持つ。2 台が同時に転送を取り合わない | 未決定 |
| 遠隔の管理 | 遠隔から管理できるようにする（owner 決定）。経路の作りは debug 経路の設計（AWAI-3676）に合わせ、ADB を network に開けない | 決定。経路の設計は未着手 |
| OTA と再起動 | 更新で再起動しても、無人で配信に戻る。失敗したら前の版に戻る | AWAI-3060 に依存 |
| 画面が無い | 状態、容量、直近の失敗を、管理の経路と Linear に出す | 未決定 |

## 6. 段階

どの段階も、Linux の node を残したまま進める。戻すときは、転送と DNS を Linux の node に戻す。

| 段階 | やること | 確かめること | 前提 |
|---|---|---|---|
| 0 | gad と Xavier の機種を確かめる | アーキテクチャ、ブートの方式、保存領域 | — |
| 1 | gad で永続インストールを通す | 再起動後も OS とデータが残る。既存の OS を起動できる状態を保つ | AWAI-3060／3061。gad が x86_64 のとき |
| 2 | node プロファイルを作る（保持だけ） | 解除前から起動する。pin した CID を loopback で返す。利用者の端末の既定では動かない | 段階 1 |
| 3 | 入口を足す | 許可した名前だけを返す。それ以外は 404、GET と HEAD 以外は 405。証明書の取得と更新 | 段階 2 |
| 4 | gad で app を 1 件配信する | Linux の node と同じ内容（digest が一致）。再起動と更新のあとも戻る | 段階 3、Linux の node の復旧 |
| 5 | 引き取り | 主が落ちたら待機が引き取る。2 台が取り合わない | 段階 4 |
| 6 | Xavier を Android にする（owner 決定） | Jetson のモデルを確かめ、動く Android の土台があるかを調べる。無ければ機種対応の作業になる | 段階 0 |

本番の経路（転送、DNS）を変える段階は、検証と戻し手順を付けて、個別の承認で行う。

## 7. 決定したことと、残る課題

owner 決定（2026-11-21）。「残る課題」は決定を実現するのに要るもので、決定を覆すものではない。

| # | 項目 | 決定 | 残る課題 |
|---|---|---|---|
| 1 | 実装の選択 | **自前の常駐サービスにする。** Kubo と Nginx は同梱しない | 入口（HTTPS、証明書の取得と更新、許可する名前の一覧）は新規。IPFS の gateway としての互換（UnixFS、IPNS、DNSLink の解決）をどこまで自前で持つか |
| 2 | node プロファイルの選び方 | **Awai Android の中で選ぶ。** 別の image や別の OS にはしない | setup と Settings のどこで選ばせるかは、Figma の設計が先（[design-first.md](design-first.md)）。この項目は owner の短い回答からの解釈で、違っていれば直す |
| 3 | 保存領域 | **Awai Drive の同期で、ネットワーク越しに node 間で持つ** | いまの Drive の経路は 1 ファイル 8 MiB・合計 64 MiB が上限（[drive-storage.md](drive-storage.md)）。node が持つ量（数十 GB 以上）には足りない。大きな block の扱いと、公開の block を Drive のどの面に置くかを決める必要がある |
| 4 | 遠隔の管理 | **遠隔から管理できるようにする** | 経路の設計。認証、何をできるようにするか（状態を見る、pin を足す、設定を変える、再起動）、ADB を使わないこと |
| 5 | Xavier | **Android にする** | Jetson のモデルの確認。公式に対応がある機種（TX2 NX、TX1、Nano 2GB）か、有志の preview（Xavier NX）か、見つからない機種（AGX Xavier）かで、作業量が大きく変わる |
| 6 | 1 回線・1 台への依存 | **予備の配信元を持つ。** 主は node のまま | 構成と足りないものは network-awai-apex の `docs/itonami-domain-unification-design.md` §8.7、追跡は [JUN-1414](https://linear.app/kotobalabs/issue/JUN-1414)。gateway の出どころと Cloudflare のアカウントが未確定。下の 2 と 3 は未決定 |

### 6 の段階（1 は決定、2 と 3 は未決定）

入口が家庭の 1 回線と 1 台に依存していて、2026-11 の停止はその例になった。段階を踏むことを提案する。

1. **いますぐ: 予備の配信元を 1 つ持つ（owner 決定 2026-11-21）。** 候補は Cloudflare の gateway。code は `kotobase-ipfs` にあるが、
   この repo は archive 済みで、いま動いている Worker の出どころは未確認。
   DNS は既に Cloudflare にあるので、新しい種類の依存は増えない。返す内容は CID で検証できるので、
   予備の配信元を信頼する範囲も広がらない。主は node のまま、node が落ちているときだけ使う。
2. **次に: 別の回線の node を足す。** Awai Android の node は、置き場所を選ばないのが利点になる。
   別の場所の機体を 2 台目の入口にして、名前に複数の宛先を持たせる。
   ただし家庭の回線は inbound を受けられないことがある（jacob がその例）。受けられない機体は、
   保持と P2P の配信だけを担い、入口にはしない。
3. **その先: 名前の解決も分ける。** DNS の権威を複数にする、ENS などの別の経路を足す（ADR-2609261842 の方向）。

1 だけでも、今回のような停止で名前の面が止まることは避けられる。

## 8. 確かめていないこと

- gad の機種とアーキテクチャ、Xavier のモデル
- 実機での awai-os の挙動（読んだのは、この repo の文書と設計の記述）
- node へは接続していない。いまの node の状態は、外からの疎通と tailnet の表示だけで判断した
- Jetson の Android 対応は、2026-11-21 の検索で見つけた範囲。古い情報を含む可能性がある
