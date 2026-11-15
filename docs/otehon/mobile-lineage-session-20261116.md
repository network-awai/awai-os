# moto g05: LineageOS 導入の実機準備 (2026-11-16)

[AWAI-681](https://linear.app/kotobalabs/issue/AWAI-681)。Jun は moto g05 の
LineageOS/Android を土台に Awai を動かす方針を選び、接続・デバッグ許可と
「残すデータなし・全消去可」を明示した。これは NixOS のスマホ移植とは別経路。

## 実機と USB の確認

- [読取り専用 P0](mobile/moto-g05-p0-20261116.txt): moto g05 / XT2523-5 / retjp / lamul。
  Android 15、VVTA35.51-153、security patch 2026-04-05。
  前回の VVTA35.51-137 から変更されていた。locked=1 / green / OEM permission=0、SIM なし。
- 電池95%、温度26.0℃を観測。Android の account service が示す Google account record は0件。
  これは FRP 無効の証明ではない。アカウント名や識別子は収集・記載しない。
- ADB で対象を明示して bootloader に再起動し、host fastboot の product=lamul、
  unlocked=no、secure=yes、slot=b を読めた。
  bootloader は `lamu-83a6a8df6a-20260123184759-20260326221954`。
- 専用 Lima `awai-681-mobile-x86` を再開。QMP で fastboot USB (22b8:2e80) のみを
  guest に attach し、guest の lsusb と root 実行した同梱 fastboot の product=lamul 読取りが成功。
  一般ユーザーでは権限不足だった。読み書き用の root 実行はこの task guest 内に限定。
- `getvar anti` は未対応、version-preloader は空値。rollback の安全性はこれで確定しない。
- fastboot の attach を解除し、host fastboot から stock Android に reboot した。
  ここまで flash/wipe/unlock は実施していない。

## 配布物と残る確認

- 前回の同一ビルド4 artifact と VM/ログは既存 preparation worktree に保持。
- maintainer の HTTPS 配布 ZIP を再取得し、SHA-256 は前回と一致:
  `e1349f76a17341b24d47a04d275fccb5e0d19bb9b298bc4b2c69704c6ef07ea3`。
  これは取得物の同一性であり、独立した配布者署名検証とは異なる。
- [LineageOS device tree](https://github.com/LineageOS/android_device_motorola_lamu/blob/10b4a8610452f72d5706672e80d0a5e7767c288e/proprietary-firmware.txt)
  の firmware 基準は VVTA35.51-153/cebf3c で実機と同じ版。
  ただし同梱 kaeru の元 LK build string は実機と異なるため、これだけで解除 payload の適合を認定しない。
- [maintainer の解除手順](https://blog.r0rt1z2.com/posts/unlocking-moto-g05-g15-bootloader/)に沿って、
  次は電源OFF接続の MediaTek USB と同梱 Antumbra の読取りを検証する。
  tanuki 全体は診断として起動しない。改変される設定領域・bootchain の原本を別保存してから書込みを検討する。
  純正復旧手順・rollback・独立した payload 来歴は引き続き未確認。

## 境界

PR #98 は 2026-11-14T12:43:59Z に merge commit
`b1f87847189d566ed2f21cc8813aa4b2a7ab2139` で merge 済み。
その成果は collector/計画/host 準備であり、今回の実機 LineageOS 起動や Awai 動作を証明しない。
本記録の USB 成功も MediaTek 接続や解除成功へ読み替えない。

## 電源OFF接続の検証

Jun の電源OFF→再接続後、host に MediaTek `0e8d:2000` / MT65xx Preloader が現れた。
同じ物理ポートだけを対象に QMP USB を attach したところ、guest kernel でも device を認識したが、
`string descriptor 0 read error: -75` と `can't set config #1, error -32` の後に切断した。
同梱 Antumbra 1.1.0 の `pgpt` は読取り待ちのままで成功せず、停止した。
これにより fastboot の USB 成功だけでは MediaTek の転送を認定できないことが実測で確認された。

その QMP device を削除し、Mac 用 Antumbra 1.0.0 の `pgpt` による直接接続を検証中。
既に release digest を照合した別版であり、同梱1.1.0の代替として書込みに使えるとは認定しない。
最初の待機は接続待ちで時間切れ。再接続を依頼し、次の読取りを待機した。
ここまで原本パーティションの読取り成功・保存は0件、unlock/flash/wipeも未実施。
生ログと tool 状態は task-local に保存し、private partition や device ID を Git に入れない。
