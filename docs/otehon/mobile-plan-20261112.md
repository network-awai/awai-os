# Otehon のスマホ対応: 機種別ゲートと非破壊試作

[AWAI-681](https://linear.app/kotobalabs/issue/AWAI-681)、2026-11-12。
これは Android 全面置換に至る設計と試作計画。スマホ用 OS イメージの提供・起動成功を示すものではない。
今回実行した実機操作は、既に ADB を許可した moto g05 の状態読取りのみ。

## 確認したソース

- awai-os: `3be3ddef3dffd6078a1d99f4f69a70626540934a`。
- [default.nix](../../nixos/otehon/default.nix) は aarch64/x86_64 の CPU 選択。
  [common.nix](../../nixos/otehon/common.nix) は QEMU guest、GPT の ESP/ext4、systemd-boot と UKI、
  仮想マシン用の serial console を組み立てる。aarch64 を選ぶだけでスマホの BSP にはならない。
- [hardware-6600h.nix](../../nixos/otehon/hardware-6600h.nix) は x86_64 PC 専用。
  [install-0.1.0.md](install-0.1.0.md) の Secure Boot 未署名、更新未統合、root 16GB 固定という制限は、
  PC installer の制限でありスマホの導入手順ではない。この installer をスマホに流用しない。
- [eval-profiles.sh](../../nixos/otehon/eval-profiles.sh) は derivation の評価のみ。
  [CI](../../.github/workflows/nixos-module.yml) の Otehon job には shell/C1/storage の試験と
  storage derivation の build もあるが、OS image の build/VM boot はない。
  「CI が評価のみ」は image 検証の説明に限る。全 job が build しないという意味ではない。
- awai-mobile: `ebe2ce3`。`android/app/src/main/AndroidManifest.xml` は INTERNET 権限の Android app、
  `MainActivity.kt` は自 assets の WebView と鍵・QR bridge。OS の起動・置換機構ではない。
  同ファイル 44–48 行の host 判定は assets の interception と画面遷移の拒否で、
  外部 fetch 全体の禁止を証明しない。外部操作は `src/awai/operations.cljs` と CSP/broker の対象。
- awai-mobile の `scripts/vendor.sh` は `vendor/PINS.json` の digest を検査して bundle する。
  `js/vendor.js` が取り込む broker は canonical な
  `kotoba-lang/kotoba/lib/kotoba.wasmWebcomponent/src/kotoba-client-runtime.js` と一致した。
  SHA-256: `5a950051c484a992caba0ad9edff780938648f9cade0b18f2d016812742ee6fb`。
  pin revision は `91ed14c090c90ceff833a868f1685c8840503f76`。これはソース一致の確認であり、
  moto 上の APK 動作・同意・実アカウント連携の検証ではない。
- network-awai-apex ADR 0026、確認 revision `8279fe59153fb8241a816e95bebc4ec53112efc5`:
  Otehon/Native の分離、D13 のログイン・trust、D18 の `.cljc` 方針を維持する。

既存の正本・設計契約は変更していない。今ある phone profile ではなく、以下のゲートを満たす機種別 port が必要。

## 実機の記録と不明点

| 対象 | 確認内容 | 次に満たす条件 |
| --- | --- | --- |
| moto g05 / XT2523-5 | 今回の [P0 読取り](mobile/moto-g05-p0-20261112.txt): lamul/lamu、mt6768、arm64-v8a、Android 15 VVTA35.51-137、locked/green、OEM 許可=0、SIM=ABSENT,ABSENT。XT2523-5 と retjp は前回 issue の記録で、今回の collector は SKU を再測定していない | OEM toggle が許可される条件、地域/SKU の公式 unlock 対象判定、機種別 port/復旧物を確認。現状は全面置換に進めない |
| Samsung SC-42A | 前回 issue に unlock、TWRP 書込み、その後 AVB failure/boot loop の記録あり。今回は ADB に現れず、復旧成功は確認できない | 現状の画面・USB mode の観察、機種・bootloader revision に合う純正復旧物の取得・検証。別途許可された復旧作業として扱う |

moto の `ro.oem_unlock_supported` は空であり `unknown` と記録した。空を非対応の `0` と解釈しない。
Treble/A-B/dynamic partitions は Android 側の属性で、NixOS 起動可否や実際の全 partition map は示さない。
fastboot の unlock_ability=0 と OEM get_unlock_data が unknown command だったことは前回記録で、今回再起動して追試していない。

前回コメントの「物理 SIM 入手が公式 unlock の前提」は未確定。現在の確定事項は SIM 不在と OEM 許可=0。
[AOSP の規定](https://source.android.com/docs/core/architecture/bootloader/locking_unlocking) は
unlock ability と OEM 設定の関係を示すが、この SKU に SIM が必須・十分とは示さない。
[Motorola 公式入口](https://en-us.support.motorola.com/app/standalone/bootloader/unlock-your-device-a) も機種の対象確認を求める。
SIM 購入や挿入だけで解決すると約束せず、unlock code 取得・規約同意・設定変更は今回実行しない。

Samsung の「残るは vbmeta 同時書込みのみ」という前回評価も未検証。
A20 由来カーネル/DTB の適合、partition サイズ、AVB chain と純正復旧を未確認のまま、
空 vbmeta を追加すれば TWRP が起動するとは判断しない。生成済みファイルは検証済み復旧イメージではない。

## P0–P4 の受入ゲート

各段階は独立した証跡を残す。P1 が通っても P4 は通らず、Android companion を NixOS と呼ばない。

| 段階 | 手順・受入条件 | 負の対照・停止条件 | 今回の状態 |
| --- | --- | --- | --- |
| P0 個体特定 | 明示選択した ADB target だけで機種、board、build、lock、SIM を読取り。空値/取得失敗を unknown とする。公開証跡から serial/IMEI/SSID/account を除く | 未接続・unauthorized・offline は collection を開始しない。複数端末でも自動選択しない | moto を再測定。Samsung の現在状態は未確認 |
| P1 VM 再現 | 同じ revision/pin の image build、raw image digest、QEMU/firmware 版、serial boot report `failed=0` を記録。まず network/login のない `vm`、必要なら desktop を別に検証 | blank disk が report を出さず失敗、missing image が NOT_RUN になる。単なる Nix 評価を起動成功としない | 既存 [VM 手順・過去の正負結果](vm-0.1.0.md) を参照。今回 build/boot 未実施 |
| P2 PC 手順比較 | 6600h の EFI/GPT/UKI/LUKS とスマホ固有 boot chain/partition/encryption を比較。実機 installer は実行しない | PC イメージを phone target に渡さない。容量・CPU 一致だけで適合としない | 机上整理済み。スマホに installer は流用不可 |
| P3 companion | 既存 awai-mobile を immutable revision/digest で build。ローカル asset 起動、portrait/insets、offline 表示、QR cancel、鍵が JS に出ないことを端末で観察。外部接続は次段の同意試験に分ける | 外部操作拒否で request=0、同意は表示した service/endpoint/operation にのみ有効。別 endpoint/再利用/未宣言 route を拒否 | ソースと broker digest の確認まで。APK 未導入、端末・連携試験未実施 |
| P4 全面置換設計 | 下記の機種別前提と復旧・鍵・更新設計が揃い、レビュー可能な image manifest と試験計画があること | 適合が不明、復旧が未確認、署名/AVB chain 不明、owner の別途実行許可なしでは書かない | 設計のみ。phone image/BSP・起動実証はない |

P0 の再測定は repository root で、serial を shell history 等に不用意に残さない方法で指定する。
出力先は新規ファイルにし、既存証跡を上書きしない:

```sh
# adb_serial は作業者が既に許可した端末を明示指定する値。collector は出力に載せない。
( set -C; sh scripts/otehon-mobile/collect-p0.sh "$adb_serial" > .agent-output/p0-new.txt )
sh scripts/otehon-mobile/test-collect-p0.sh
```

collector は host-side の診断補助で、app/runtime/Native gate には入れない。
`get-state` と固定 allowlist の `shell getprop` だけを実行し、reboot/root/install/fastboot は行わない。
exit は 0=全読取り完了（空 property は unknown）、1=一部の読取り失敗、2=引数不備、3=実行不可。
`collection_status=0` は unlock 許可でも OS 適合判定でもない。USB transport が停止した場合は作業者が中断し、未完の出力を合格扱いしない。

## 機種別 port と汎用化の境界

共通にできるのは Otehon の UI/`.cljc` domain code、browser local state、外部 operation の記述と同意、
検証 manifest の schema と判定手順。次の部分は SoC・SKU・bootloader revision ごとに揃える:

1. **起動と復旧:** 純正 build と rollback index に適合する recovery package、取得元・digest・利用条件、
   USB recovery mode への物理手順、partition map と A/B slot の実測。復旧可能性は Download mode の存在だけでは証明しない。
2. **BSP:** 対象カーネルの source/config、DTB/DTBO、initramfs、必要 firmware と再配布条件。
   `mt6768` や `universal7884B` の文字列一致で別機種の image を採用しない。
3. **image と検証 chain:** Android boot/vendor_boot/init_boot/recovery 等は存在を実測して決める。
   header version、サイズ、AVB descriptor/chain、rollback protection を記録。
   EFI disk image を Android partition に書く設計にはしない。
4. **最初の起動:** display/console と read-only root までを最小目標にし、touch、充電・温度、suspend、
   storage、Wi-Fi を個別の観測ゲートにする。modem/通話/GPU は別 qualification、未確認を利用可にしない。
5. **鍵と更新:** Android FBE/Keystore/Knox の鍵を NixOS LUKS/age に持ち込める前提にしない。
   ユーザーによる export/restore、署名者、trial boot/rollback、失敗時の復旧を機種別に定義し、実鍵は fixture と分離する。

port manifest の必須項目は `vendor/model/SKU/SoC/build/bootloader-revision`、
`partition-map`、`source-revisions`、各 artifact の `sha256/size/license`、
`AVB/rollback constraints`、`recovery-evidence`、`tested-capabilities`。
未測定値を埋めた架空の manifest や phone profile は作らない。

## companion の実行境界

origin は静的配布のみ。ブラウザーが UI/workflow/state を実行し、外部 identity/storage/relay/model は
canonical broker の操作ごとの直接同意を経て直接接続する。APK 配布や model download も取得元・digest と同意を分ける。
Bot の tool 許可を app の操作同意に流用しない。D13 の login/trust は取引許可の代わりにはならない。
Samsung/moto、Otehon/Native の間で黙って fallback しない。

P3 の APK build は awai-mobile の既存手順を使い、revision、APK SHA-256、署名証明書を記録してから
OS を変えない試験として導入する。いまの端末で未導入のため、鍵生成/実署名/外部 relay への送信も未検証。
D13 の中継配置、L1 取引系、grant/sealed-state はこの計画で決定していない。

## 検証結果と再開点

- 固定コマンド列・明示 target、offline/unauthorized 拒否、property 失敗、空値、serial の非出力を fake ADB で確認。
- moto g05 の allowlist 読取りを実行し、上記 P0 証跡を保存。今回 flash/wipe/unlock/reboot/APK 導入なし。
- P1 build/VM、P3 APK/実連携、P4 スマホ起動は未実施。これらを完了と数えない。

次の実行単位は P3 の pinned APK build と offline 起動試験、または P1 の同 revision での VM 再現。
全面置換を進める場合は、まず moto の公式 unlock 適格性と機種別復旧/BSP を確認する。
Samsung は現状観察・純正復旧物の検証から別に再開する。

追記: 同日の[LineageOS 解除・導入調査](mobile-lineage-research-20261112.md)で、XT2523-5 の公式機種定義と配布、
maintainer の tanuki/kaeru 経路を確認した。SIM 待ちだけを進路とせず、この個体と bootloader の適合・復旧を次に確認する。
