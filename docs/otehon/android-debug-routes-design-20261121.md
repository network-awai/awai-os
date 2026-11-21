# Awai OS の debug 経路の設計（PC・mobile）

2026-11-21、AWAI-3676。状態: **提案**。「owner 決定」と書いた項目は、決定済みと明記したもの以外は未決定。
この文書は設計と現状の記録であり、image・実機・権限を変更しない。

## 結論

- PC 版も mobile 版も、debug 経路は製品として設計されていなかった。あるのは検証 script が使う ADB だけである。
- PC 版の image は upstream の設定を引き継いでおり、ADB を有効にすると **TCP 5555 を全 interface で待ち受ける**。記録にある PC image は全て `userdebug` で、出荷用の `user` build の記録はない。
- 出荷 image は `user` build に限り、ADB を既定で無効にする（owner 決定 2026-11-21）。あわせて TCP 5555 の既定値と `android_insecure_adb` を外す（提案、実装は AWAI-3682）。対応する debug 経路は、PC・mobile とも USB debug と wireless debug の両方（owner 決定 2026-11-21）。PC の USB debug は実現方法が未調査で、対応機種と方法は別 issue で決める。

## 現状（測定）

### ソースと repo（2026-11-21 に読み取り）

| 項目 | 値 | 出典 |
| --- | --- | --- |
| PC image の土台 | LineageOS の `virt-common`（Awai の patch を上に当てる） | `android/desktop/pc-ab-device/patches/virt-common-awai-pc.patch` |
| ADB の TCP port | `service.adb.tcp.port=5555` が product の既定 | upstream `LineageOS/android_device_virt_virt-common` `configs/properties/product.prop`（`lineage-24.0`、最終変更 40557ac0、2025-03-04） |
| Awai の patch による上書き | なし（patch 群に `adb` の変更は `load_env` の 1 行だけ） | `android/desktop/pc-ab-device/patches/*.patch` |
| `android_insecure_adb` | grubenv から読まれ、`1` なら kernel に `androidboot.insecure_adb=1` を渡す。upstream の説明は「ADB の認証を無効にし、ADB root を有効にする」。既定は `0` | upstream `bootmgr/grub/grub-boot.cfg`、`configs/misc/grubenv.txt`、`README.md`。Awai の patch は同じ `load_env` 行を保持 |
| 記録にある PC image の variant | 全て `userdebug`（`test-keys` と `release-keys` の両方） | `android/desktop/vm-boot-check/README.md`、`android/desktop/derived-image/evidence/desktop-boot-20261117.json`、`android/desktop/pc-ab-device/evidence/*.json` |
| `user` build の PC image | 記録なし | 同上を検索 |
| PC 実機（6600H）の接続 | Mac と直結した LAN で `10.77.0.2:5555` | `android/desktop/persistence/README.md` |
| PC の VM の認証 | `android_insecure_adb=1`、または host の公開鍵を `/data/misc/adb/adb_keys` に書く。どちらも script に「VM only」と明記 | `android/desktop/pc-ab-device/kvm/*.sh`、`android/desktop/vm-boot-check/bm-boot-check.sh` |
| 初期設定前の ADB | 7735HS の RAM Live で「trade-in ADB が応答した」「制限された ADB では画面を取得できなかった」 | PR #302 の本文（未 merge、候補） |
| mobile（moto g05） | 利用者が USB debug を許可し、対象を明示した ADB shell で起動情報を取得 | `archive/android-bringup/mobile/moto-g05-lineage-core-acceptance-20261116.json` |
| wireless debug（ペアリング方式） | PC・mobile とも記録なし | repo 全体と Linear を検索 |

### 実機（2026-11-21 14:35 JST 頃、Mac から読み取りのみ）

| 対象 | 結果 |
| --- | --- |
| 6600H（`10.77.0.2`、MAC は記録と一致） | ping 応答あり。TCP 5555 は閉、18092 は開（HTTP 404）、22 は閉。Android は起動しておらず、ADB で読めない |
| moto g05 | Mac に接続されていない（`adb devices` は空） |

次の値はどの実機でも **unknown**（0 や「無効」ではない）: `ro.debuggable`、`ro.adb.secure`、`persist.sys.usb.config`、`service.adb.tcp.port`、`persist.adb.tcp.port`、`persist.adb.tls_server.enable`、`adb_keys` の有無、6600H の ADB を誰がどう承認したか。
取得方法（読み取りのみ。対象を明示する）:

```sh
adb -s <serial> shell 'for p in ro.build.type ro.debuggable ro.adb.secure persist.sys.usb.config service.adb.tcp.port persist.adb.tcp.port persist.adb.tls_server.enable ro.boot.insecure_adb; do echo "$p=$(getprop $p)"; done; settings get global adb_enabled; settings get global adb_wifi_enabled; ls -l /data/misc/adb 2>&1'
```

### 現状から言えること

- `userdebug` build は AOSP の一般的な挙動では ADB が既定で有効になる。そこに `service.adb.tcp.port=5555` が加わるので、`userdebug` の PC image を客先の LAN につなぐと 5555 が LAN から見える可能性が高い。この image での既定値は上のとおり未測定。
- `android/desktop/README.md` の「5555 を LAN に公開しない」は運用上の注意であり、image 側にそれを守る仕組みはない。
- grubenv は persist 区画にあるので、disk に書ける者は `android_insecure_adb=1` を設定できる。

## 設計（提案）

### 経路ごとの方針

| 経路 | PC 版 | mobile 版 | 既定 | 認証 |
| --- | --- | --- | --- | --- |
| USB debug | 対応する（owner 決定 2026-11-21。実現方法は未調査） | 対応する | 無効 | host の RSA 鍵を画面で承認 |
| Wireless debug（TLS、ペアリング） | 対応する | 対応する | 無効 | ペアリングコードまたは QR、その後 TLS |
| 平文の TCP 5555 | 出荷 image では**無効**。開発用 image と VM のみ | 対応しない | 無効 | 開発用: RSA 鍵。VM: 現行の insecure 設定を許す |
| `android_insecure_adb` | 出荷 image では**受け付けない**。VM の検証のみ | 該当なし | 0 | なし（認証を外す設定） |
| 初期設定前の trade-in ADB | 未決定（下記） | 未決定 | AOSP の既定 | AOSP の既定 |

### 理由

1. **出荷 image は `user` build に限り、ADB を既定で無効にする（owner 決定 2026-11-21）。** `userdebug` は ADB root と `ro.debuggable=1` を持ち、利用者の端末に出すものではない。`android/lockscreen-design-qualification-20261116.md` も本番 build を `ro.debuggable` 0 と前提している。
2. **PC の network 経路は wireless debug。** 今の検証も network 経由である。wireless debug は TLS とペアリングがあり、平文の 5555 より LAN 上で安全。
3. **PC でも USB debug に対応する（owner 決定 2026-11-21）。** mobile 版と同じ 2 経路をそろえる。当初の提案は「対応しない」だったが、owner が両方に対応すると決めた。実現方法は下の「PC の USB debug の実現条件」のとおり未調査で、機種ごとに対応可否が分かれる可能性がある。
4. **平文の 5555 は開発用に限る。** 現行の検証 script（`10.77.0.2:5555` の直結）は開発用 image で使い続けられる。出荷 image からは `service.adb.tcp.port` を外す。
5. **`android_insecure_adb` は出荷 image で無効にする。** grub の `load_env` の一覧から外すか、`user` build で `androidboot.insecure_adb` を無視する。どちらにするかは実装 issue で決める。
6. **設定画面の導線は AOSP 標準のまま。** 「ビルド番号を 7 回」→ 開発者向けオプション → USB debug／wireless debug。Awai 独自の UI は足さない。

### owner 決定が要る点

- A. 出荷 image の build variant: **決定済み（2026-11-21）。`user` build に限り、ADB を既定で無効にする。** `userdebug` の image は開発と検証に限り、客先には出さない。この決定の時点で `user` build の PC image は記録になく、build・署名・起動の検証は未実施である（AWAI-3682）。今日（2026-11-21）の初回導入（AWAI-3600）の候補の variant は、この文書では確認していない。
- B. 初期設定前の trade-in ADB を出荷 image で残すか。Android の標準機能だが、設定完了前の端末に network から届く経路になる。
- C. PC の USB debug: **決定済み（2026-11-21）。対応する。** wireless debug と両方に対応する。

### 未確認で、設計に影響する点

- AOSP の wireless debug の切り替えは Wi-Fi 接続を前提にしている。有線 LAN だけの PC で設定画面から有効にできるかは未確認。できない場合は、Ethernet でも有効にできるよう Settings を変えるか、PC では開発用 image の 5555 だけにするかを選ぶ。
- 6600H に Wi-Fi があるか、Android から使えるかは、この文書では調べていない。

## PC の USB debug の実現条件（未調査）

USB で ADB を受けるには、PC 側が USB の device として動く必要がある。次の 3 点がそろうかを機種ごとに調べる。どれもこの文書では未測定である。

| 条件 | 調べ方（読み取りのみ） | 現状 |
| --- | --- | --- |
| device mode で動く USB controller とポートがある | 実機で `ls /sys/class/udc`、`ls /sys/class/typec`、`ls /sys/class/usb_role` | unknown（6600H、7735HS、7735H とも） |
| kernel に UDC の driver、gadget、FunctionFS がある | build した kernel の config で `CONFIG_USB_GADGET`、`CONFIG_USB_CONFIGFS_F_FS`、controller の driver を確認 | unknown。この repo の patch と文書に該当の設定は見つからない |
| Android 側が gadget で ADB を出す（`sys.usb.config`、USB HAL、init の設定） | `virt-common` の init と HAL を確認 | unknown |

- 条件 1 を満たさない機種では、ソフトウェアだけでは USB debug を実現できない。その場合の扱い（その機種は wireless debug のみとする、対応ポートを持つ機種を要件にする、など）は調査結果を見て owner が決める。
- USB の A-A ケーブルや host 同士の直結では ADB は通らない。
- USB の Ethernet adapter を挟んだ接続は network 経路であり、USB debug ではない。

## 検証（対応すると決めた経路ごと）

各項目は実機で行い、負の対照を必ず付ける。VM の結果は実機の受入に読み替えない。

| # | 対象 | 手順 | 合格 | 負の対照 |
| --- | --- | --- | --- | --- |
| V1 | PC 出荷 image | 初期設定直後に上の読み取りコマンドの値を console から取得し、LAN の別 host から 5555 に接続 | `ro.debuggable=0`、`adb_enabled=0`、5555 に接続できない | 同じ手順を開発用 image で行い、5555 に接続できることを確認（検査が効いている証拠） |
| V2 | PC 出荷 image | grubenv に `android_insecure_adb=1` を書いて起動 | ADB は無効のまま。認証は外れない | 開発用の VM image では同じ設定で認証が外れる |
| V3 | PC wireless debug | 設定画面で有効にし、Mac から `adb pair` → `adb connect` → `adb shell getprop` | ペアリング後に shell が開く | ペアリングしていない host からの `adb connect` が拒否される。無効に戻すと接続が切れる |
| V4 | mobile USB debug、PC USB debug（対応機種） | 有効にして Mac に接続 | 画面の承認後に shell が開く | 承認前は `unauthorized`。承認を取り消すと再び `unauthorized` |
| V5 | mobile wireless debug | V3 と同じ | V3 と同じ | V3 と同じ |
| V6 | 両方 | 再起動後の状態 | wireless debug は再起動で無効に戻る（AOSP の既定）か、設定どおり | 記録のみ |

証跡は日付つきの JSON で `android/desktop/` と `android/` の該当 directory に置き、コマンド、ADB の version、image の SHA-256、結果を書く。

## 子 issue に切る作業

1. 6600H と moto g05 の現行値の読み取り測定（上のコマンド。端末が Android を起動し、接続できるとき）。
2. PC 出荷 image: `user` build、`service.adb.tcp.port` の削除、`android_insecure_adb` の無効化（決定 A の後）。
3. PC の wireless debug を有線 LAN で有効にできるかの確認と、V3 の実機検証。
4. mobile の V4・V5 の実機検証。
5. trade-in ADB の扱い（決定 B の後）。
6. PC の USB debug: 上の実現条件を機種ごとに調査し、対応機種と実装方法を決める。

## この文書がしていないこと

- image、patch、実機、grubenv、ADB の承認状態の変更。
- LineageOS fork の全ソースの調査。読んだのは upstream の `virt-common` の該当 file と、この repo の patch だけである。
- `userdebug` build の ADB 既定値の実測。
