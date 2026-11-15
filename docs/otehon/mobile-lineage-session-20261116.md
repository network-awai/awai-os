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

## Mac での診断と追跡の分離

物理導入の追跡は [AWAI-2967](https://linear.app/kotobalabs/issue/AWAI-2967) へ分離した。
AWAI-681 は PR #98 の merge を確認した設計/準備単位として Done に修正し、
未導入の端末が稼働済みと解釈されないようにした。以前の利用量は親issueに残し、子へ重複計上しない。

Mac版1.0.0は再接続後も待機。接続失敗を握りつぶす upstream 実装を確認し、
[Penumbra 1.1.0](https://github.com/shomykohai/penumbra/tree/92e12caf665441bbc1e1cbfd7ecf6914f09fc6dc)
を固定して取得した。接続探索/オープン失敗の表示だけを加えた
[診断patch](mobile/penumbra-open-diagnostic-20261116.patch)で確認した。
端末への書込み処理や接続の成功条件は変更していない。

- 開発用hostで `cargo build --locked -p antumbra --manifest-path .agent-output/penumbra-source/Cargo.toml`。
  rustc 1.99.1 / cargo 1.99.1、upstream Cargo.lock の Rust 依存を取得。
  59.26秒でbuild成功（警告あり）。これは単発の運用tool構築で、Awai native build/gateへの依存追加ではない。
- NUSB版のSHA-256は `9c6c87640894922308295b83de46ff9fc72a250b8cca0ce779a0a8de2a8b49bb`。
- 一般権限で `pgpt` を待機してから再接続すると、
  `could not open interface for exclusive access (error 0xe00002c5)` を観測。
- macOS認証ダイアログでJunが認証した管理者権限でも、同じ排他アクセスエラーを再現。
  単なる一般ユーザー権限の不足とは判定できない。失敗メッセージの反復数を独立した試行数として数えない。
- 管理者読取りプロセスは通常の停止後も生存したため、そのtask processだけをSIGKILLして停止。
  他のVM/アプリ/プロセスやOSのドライバー設定は変更していない。
- `cargo build --locked -p antumbra --features penumbra/serial --manifest-path .agent-output/penumbra-source/Cargo.toml`
  により upstream の serial 接続実装を選んだ別候補を17.01秒でbuild成功。
  SHA-256は `2780445b73fdbaa4b1c3b20fbec9467dc8f696ab191ec103b233ce515349d77e`。
  version/help表示とbuildは実機での読取り・書込み互換性の証明ではない。
  一般権限で `pgpt` のみを試験し、次の電源OFF再接続を待機する。

現時点で原本保存、unlock、flash、wipe、LineageOS起動はすべて未達。
生ログ/ソース/バイナリは task-local `.agent-output` に保全し、デバイス識別子を公開記録に含めない。

## シリアル接続の成功と原本保存

電源OFF再接続でシリアル版の handshake、DA1/DA2 実行、DA SLA challenge、
partition table 読取りが成功した。`pgpt` は exit 0。
DA extensions の upload は失敗し、upstream が extensions なしで継続したため、
extensions を必要とする操作や書込み全般の互換性は認定しない。

一般権限の `read` で preloader / preloader_backup / oem_mfd / proinfo / frp /
misc / lk_a / lk_b / seccfg / boot_a / boot_b の11領域、合計160,956,416 bytesを
task-local に保存し、別の読取り処理で11ファイルのsize/SHA-256を再照合した。
これはホスト上のファイルの再照合であり、実機からの独立二重読取りではない。
private設定領域の実バイト、ハッシュ一覧、device stateはGitに入れず、専用private directoryに保全する。
未変更原本をその場でpatchするtanukiの動作は実行していない。

vendor_boot_a の `read` は I/O timeoutで終了し、0-byte出力を証跡として保持。
その後の読取り候補はまだ接続待ち。残りのvendor_boot/dtbo/init_boot両slotを
別のupstreamコマンド `read-flash` で保存する試験を準備し、電源OFF再接続を依頼した。
実機の原本保存は一部成功したが、復旧一式・write/readback・解除・導入は未達。
