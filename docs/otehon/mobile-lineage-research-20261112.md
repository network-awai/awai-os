# moto g05: LineageOS の解除・導入経路の調査

2026-11-12 / [AWAI-681](https://linear.app/kotobalabs/issue/AWAI-681) / PR #98 の追加調査。
「langu os」は LineageOS と解釈した。今回の範囲は一次情報の照合と配布物の静的読取り。
端末操作、unlock、flash、wipe、取得したプログラムの実行は行っていない。

## 結論

**moto g05 XT2523-5 は LineageOS の機種定義に含まれ、専用の解除・導入経路がある。**
Motorola の通常の unlock-code 経路だけでなく、maintainer が公開する tanuki/kaeru の経路を調べられる。
前回の「SIM 入手待ちだけが進路」という評価では不十分だった。
ただしメーカー公式の解除ではなく、boot chain を変更する方法であり、手元の日本向け個体での成功は未検証。
LineageOS は Android であり、これを入れても NixOS/Otehon の起動実証にはならない。

## 対応・配布の証拠

- [LineageOS 機種定義](https://github.com/LineageOS/lineage_wiki/blob/f33424ecc81eb1125a433419cb88ef4a5fa7f8ca/_data/devices/lamu_variant3.yml):
  `lamu` variant3=moto g05、対象に `XT2523-5`、現行 branch `24.0`、stock Android `15`、
  recovery partition は `vendor_boot`。端末の `lamul` と配布側の `lamu` は、この機種定義で対応付ける。
- [公式 build target](https://github.com/LineageOS/hudson/blob/f174bb023239c39d299565c92ef3669f3f759f33/lineage-build-targets):
  `lamu userdebug lineage-24.0 W` を確認。
- [公式配布 API](https://download.lineageos.org/api/v2/devices/lamu/builds):
  取得時の最新は `lineage-24.0-20261105-nightly-lamu-signed.zip`。
  [必要 artifact の URL/size/SHA-256 記録](mobile/lineage-lamu-artifacts-20261112.json)を保存。
  これは配布 metadata の観測で、約1GBの OS ZIP や各 image の download・実バイト検証は未実施。
- [導入ガイドのソース](https://github.com/LineageOS/lineage_wiki/blob/f33424ecc81eb1125a433419cb88ef4a5fa7f8ca/_includes/templates/recovery_install_fastboot_custom.md)は、
  [機種専用 XDA guide](https://xdaforums.com/t/unlock-bootloader-motorola-motorola-g15-power-g05-e15-lamu-lamul-lamulg.4780735/)へ誘導する。
  XDA本文は取得できず、同じ maintainer の[公開記事](https://blog.r0rt1z2.com/posts/unlocking-moto-g05-g15-bootloader/)と配布 ZIP を直接確認した。
  wiki.lineageos.org は今回 HTTP 403。検索で得た [公式 preview](https://blob.lineageos.org/preview/wiki/506566/devices/lamu/install/variant3/)だけに依存せず、現行 GitHub source と API を照合した。

## 解除方法と現在の blocker

| 経路 | 必要条件と意味 | 判定 |
| --- | --- | --- |
| Motorola unlock code | メーカーの SKU 対象判定、OEM 許可、unlock data/code が必要 | 前回 `get_unlock_data` は unknown command、OEM 許可=0。この個体で通る証拠なし |
| tanuki + kaeru | maintainer の Windows/Linux 用機種専用 tool。MediaTek 接続から boot chain を変更し、fastboot unlock と kaeru 導入へ進む | 公開実装・手順あり。ただし日本向け build との適合、復旧物、tool provenance の確認が残る |
| LineageOS の recovery/ZIP | 上の解除を終え、同一 build の boot/dtbo/vendor_boot と署名済み ZIP を用意する | 現行公式 artifact metadata を確認。端末への導入は未実施 |

[maintainer の記事](https://blog.r0rt1z2.com/posts/unlocking-moto-g05-g15-bootloader/)は Windows または Linux を前提とする。
SIM を解除の条件としては挙げていない。この手順に SIM 条件の記載がないことは確認したが、
同梱 binary の全挙動や、この個体で SIM なし解除が成功することまでは証明していない。
macOS でそのまま動くとは判断しない。Linux/Windows の USB を直接扱える環境を準備し、VM passthrough も別に検証する。

### 配布 ZIP の静的読取り

記事のリンク先 `https://cdn.r0rt1z2.com/blog/tanuki-lamu-v2.0.0.zip` を約13.4MB取得。
ZIP全体のローカル SHA-256 は `e1349f76a17341b24d47a04d275fccb5e0d19bb9b298bc4b2c69704c6ef07ea3`。
独立した配布者署名・期待 digest は未確認なので、これは取得物を識別する観測値であり真正性の独立検証ではない。
README と `tanuki.sh` を読み、同梱 binary は実行していない。

`tanuki.sh` の静的確認では、preloader と端末設定領域を読み、一部設定領域、preloader の両コピー、
boot mode 指定を書き換え、その後 unlock と両 slot の LK 書込みを行う。
**端末上の unlock 確認が出る前に書込みが始まる。** 起動して様子を見るだけの診断 tool として扱わない。
保存先が `backups/` でも、一部の読取り結果はその同じファイルを加工しており、未変更の原本一式が残るとは限らない。
事前に独立した復旧・原本保全方法を決める必要がある。shell と PowerShell の同等性・同梱 binary の完全監査は未実施。

[kaeru README](https://github.com/R0rt1z2/kaeru) は device/bootloader version ごとの適合が必要としている。
確認 revision は `2909a08f76f7a71fed547800aea206ca380245c8`。
[lamu board 定義](https://github.com/R0rt1z2/kaeru/blob/2909a08f76f7a71fed547800aea206ca380245c8/board/motorola/include/lamu.h)には Moto G05/G15/G15 Power があるが、
**この source revision と ZIP 内の prebuilt が同一由来であることや、VVTA35.51-137 の LK との一致は未確認**。
lock-state spoofing は実際の再ロック・Verified Boot の復元と別物で、今回の解除/OS試験に加えない。

## LineageOS 導入の順序（未実行）

1. `XT2523-5` と地域・現在の build を照合し、stock の機能を記録する。
   guide は Android 15 の最新 firmware を要求するため、現在の `VVTA35.51-137` がその条件を満たすか確認する。
   解除 tool との適合を調べる前に、無条件の OTA 更新・downgrade はしない。
2. データと鍵の復元手段、地域/SKU/rollback条件が合う純正復旧物、USB recovery 手順を準備する。
   guide は FRP を避けるため事前の Google account 削除も案内する。これは作業者による既存アカウントでの正規操作として扱う。
3. tanuki/kaeru の対象 bootloader、取得物・digest と復旧条件をレビューし、書込み単位を確定してから解除する。
   tool の README は unlock による全データ消去を明記する。今回の調査依頼では実行しない。
4. [boot stack テンプレート](https://github.com/LineageOS/lineage_wiki/blob/f33424ecc81eb1125a433419cb88ef4a5fa7f8ca/_includes/templates/device_specific/before_recovery_install_boot_stack.md)に従い、
   同一 build の `boot.img` と `dtbo.img`、続いて `vendor_boot.img` の Lineage Recovery を書く。
   配布一覧にある `lk.img`・`vbmeta.img`・`init_boot.img` を、一覧にあるという理由だけで追加 flash しない。
5. Lineage Recovery で data を初期化し、同じ build の署名済み OS ZIP を ADB sideload する。
   必要な add-on は初回起動前の別段階とし、まず最小 OS の確認を優先する。
6. 起動後に表示・touch・充電/温度・Wi-Fi・再起動・暗号化・更新を別々に確認する。
   通話/SMS/IMS は stock での事前確認も必要で、SIM なし試験では未検証として残る。

この流れには全消去が含まれる。署名不一致、機種不一致、復旧物なし、bootloader 不適合なら、その先へ進まない。

## 他の OS・導入方式

| 候補 | 今回の調査で分かったこと | AWAI-681 への意味 |
| --- | --- | --- |
| Android GSI | [Android Developers](https://developer.android.com/topic/generic-system-image) の共通 system image。機種別 vendor/kernel は別に必要 | LineageOS の機種専用対応があるため、最初から GSI で周辺機能を再検証する必要性は低い、という判断 |
| DSU | [AOSP](https://source.android.com/docs/core/ota/dynamic-system-updates?hl=en) は locked 状態でも信頼鍵があれば Developer GSI を許容できる設計を説明する | 任意の GSI が locked moto で起動する根拠にはならない。moto の trusted keys・DSU 有効性は未確認。解除回避策として確定しない |
| postmarketOS / Ubuntu Touch | 今回、lamu/XT2523-5 向けの検証可能な完成済み導入手順は確認できなかった。推測した postmarketOS Wiki URL は404 | 「対応しない」と断定せず、調査未確定。LineageOS の存在を native Linux の起動実績へ読み替えない |
| Mobile NixOS | [公式一覧](https://mobile.nixos.org/devices/)と [motorola-potter](https://mobile.nixos.org/devices/motorola-potter.html) は別機種 Moto G5 Plus | `G5 Plus` は `g05` と別物。その image は使わない。lamu の BSP 移植は別作業 |
| Samsung SC-42A | [LineageOS a21s 定義](https://github.com/LineageOS/lineage_wiki/blob/f33424ecc81eb1125a433419cb88ef4a5fa7f8ca/_data/devices/a21s.yml)は SM-A217系 / Exynos850 | A21s は SC-42A と別機種。A21s の ROM/recovery を流用しない。SC-42A 専用の公式導入経路は今回確認できず |

## 次に調べるもの

優先は **moto の専用 LineageOS 経路の適合確認**。
`XT2523-5 / retjp / VVTA35.51-137` に対する tanuki prebuilt の実績・LK revision、
独立した期待 digest/由来、純正復旧物と全消去前の復元確認を揃える。
揃えば「解除と LineageOS 導入」の具体的実行単位にできる。Otehon 自体の移植はその後も独立した未達項目。
