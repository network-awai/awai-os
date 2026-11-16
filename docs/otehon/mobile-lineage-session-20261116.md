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

## 通常起動を経た再接続 (09:08 JST)

Jun が通常のAndroid起動→画面から電源OFF→再接続を実施。
新規セッションの `read-flash vendor_boot_a` は handshake/DA1転送/同期byte受信まで進んだが、
DA1起動応答で I/O timeout。原本ファイルは作成されず、前の11領域は保持。

upstream の serial port 初期timeoutとreset既定値は1000msだった。
読取り専用の試験候補に限り、[2箇所を10000msへ延長](mobile/penumbra-serial-timeout-20261116.patch)。
書込みやDA処理の成功条件は変更していない。前のlogging patchと順に適用する。
`cargo build --locked -p antumbra --features penumbra/serial --manifest-path .agent-output/penumbra-source/Cargo.toml`
は9.44秒で成功、`--version`は1.1.0。
候補SHA-256は `523257d4211161261fc87f43d751b3a1a1bc4f2e4b20f07a53e6834b736615c1`。
両patchを元sourceへ適用してbuilt sourceとのbyte一致を確認した。
初回に成功したPreloader接続と同じverbose設定で、次の通常起動→電源OFF接続を待機する。
これは待ち時間変更の試験であり、実機通信の安定性や書込み成功をまだ認定しない。

## 10秒候補の実機成功と次の変更単位

通常起動→電源OFF再接続により10秒候補がDA1/DA2/SLAまで成功し、
`read-flash`で残り6領域（vendor_boot/dtbo/init_bootの両slot）を保存した。
先の11領域と合わせ17領域328,728,576 bytesをホスト上で再hashし、記録値と一致。
USER領域のraw readが成功した一方、EMMC-BOOT1のpreloaderを別方式`read-flash`で
再読取りする試験はtimeoutした。preloader原本は先に成功したnamed uploadで保持している。
この失敗をUSER領域すべての読取り非対応とは一般化しない。
その後のnormal reboot候補もtimeout。次は新しいcold接続が必要。

次の単位は、既にJunが承認した解除手順のうち、設定3領域の変更と読み戻しに限る。
maintainerの指定通りoem_mfdの4096、proinfoの552、frpの最終byteを0→1にする
privateな変更コピーを準備し、変更が各1byteだけであることを確認した。
原本を改変せず、3領域を既知のnamed uploadで再読取りし元size/hashがすべて一致した場合だけ、
1領域ずつSetRscInfoで書いて直後にnamed uploadでsize/hashを照合する。
失敗時は次の領域へ進まない。preloader/LK書換え・unlock・wipeをこの単位に含めない。
当該処理のcold接続待機を開始し、通常起動→電源OFF接続をJunに依頼した。
DA_BR/preloader_raw/kaeruの既存bytesは再取得したmaintainer ZIPの対応entryと一致した。

## 2.0候補の構築のみ

公式2.0 tagのcommit `f72152076bb4c0a3fd0f2febefdde40935a2e4c5` を別に取得。
Mac CLIは上流設定でlibusbを使用する。stableではacon依存のnightly featureでbuild失敗。
`rustup toolchain install nightly-2026-11-15 --profile minimal`で固定nightlyをmanaged storeへ追加し、
既存stable/defaultは変更せず、`cargo +nightly-2026-11-15 build --locked -p antumbra --no-default-features
--manifest-path .agent-output/penumbra-v2/Cargo.toml`が35.15秒で成功。
version2.0.0/help成功、SHA-256は `ce4acd1caa4394678c7065943f8d741c029f01cc30147f4f01253108183ffec5`。
2.0は実機に接続していない。新機能の遠隔認証も設定・実行していない。

## 2.0 Mac libusb と設定3領域の変更成功 (09:30 JST)

シリアル版の設定変更候補は、最初の原本読取り中にBroken pipeとなり、書込み前に停止。
2.0に[接続失敗の表示だけを加えたpatch](mobile/penumbra-v2-open-diagnostic-20261116.patch)を適用し、
固定nightly/locked buildが6.20秒で成功。診断候補SHA-256は
`816682b860d70a4793344864cbf0c343c0847e9706bfe8e2e1dd4dff73af239e`。
Mac libusb/管理者権限でpgptがexit0、handshake/DA1/DA2/local SLA/partition一覧が成功した。
遠隔署名は未使用。最初の認証と接続のタイミングでは捕捉できず、起動済み状態での再接続で成功。

Junが認証した同じ経路で、既に承認された解除用設定変更を実行した。
3領域のnamed uploadを先に行い、すべて元のsize/hashと一致した後、
oem_mfd→proinfo→frpの順でmaintainer指定のSetRscInfo書込みとnamed upload再読取りを行った。
各領域のreadback全体が準備した1byte変更コピーと一致し、3件とも成功。
副次的に確認した比較処理でも3ファイルが変更コピーとbyte一致した。
原本17領域は未変更でprivateに保全。

proinfo転送中に監視側timeoutを避けるためtask監視processへのSTOPを試したが、
その時点で既に3領域が完了しておりNo such processで終了。停止や中断は実際には発生しなかった。
preloader/LK、unlock/wipe、OS導入はこの時点では未実施。

次のpreloader段階に備え、保持済み両原本からGFH FILE_INFOのfile_lenに従って
未加工のstock raw候補も別保存した（330708/331428 bytes）。これは復旧形式の保全であり、
書き戻し成功の証拠ではない。次は両preloaderの再読取り、機種専用配布物のdownload、
再読取りで配布bytesの一致を確認し、bootloaderへの遷移へ進む。

## preloader 両コピーの変更と照合成功 (09:36 JST)

次の管理者単位で、preloader / preloader_backupをnamed uploadで再読取りし、
両方とも最初の4MiB原本のsize/hashと一致した。
固定SHA-256を確認したmaintainer ZIPからpreloader_raw.imgを取り出し、
GFH FILE_INFO / declared file_len=329588が実長と一致することを確認。
`write`(named Download)で1領域ずつ書き、各領域をnamed uploadで読み戻した。
両readbackとも4MiBで、GFH offset2048からの329588 bytesが配布raw全体と一致した。
一方を照合する前に次の領域へは進めていない。

この時点では設定3領域とpreloader両コピーが変更済み。
原本17領域と両stock raw候補を保持。LK書換え・unlock・wipe・OS導入は未実施で、
新preloaderでの実bootと復旧の実証も未達。次はmiscのbootonce-bootloader指定を
読み戻し確認し、Junの音量ボタン操作に合わせてDAから再起動する。

## 新preloaderの起動確認失敗と純正復旧への切替

miscは最初から`bootonce-bootloader`を含んでおり、この段階の書込みは不要だった。
再読取りで期待値を確認した後、認証済みhelper内でJunの音量UP準備の合図を待ち、
DA rebootを実行した。toolは成功を返したが、Fastbootは検出されず、Junの画面観察も黒いまま。
USBを抜いてPower+VolumeUpを30秒押す公開手順も、boot menuを表示できなかった。
したがって新preloaderの実bootは失敗/未確認で、readback一致を起動成功と扱わない。
原因を現在のfirmware/地域/DRAM/bootloaderのどれかに断定しない。
LK/Lineage image書込み、unlock/wipeは未実施。

次は、同じ実機から保存した両stock preloader rawと設定3領域を戻し、
各readbackを照合してから通常bootを試す。原本17領域と不成功ログは保持。
新しい復旧helperはこの実機のoriginal/patch hash一致を入口条件にし、固定された復旧操作だけを持つ。
同じ一時認証処理内で、復旧後の終了または純正preloaderを保持する解除設定の限定再試行を選べるようにした。
任意command/socket serviceや恒久的な管理者認証ポリシーは導入していない。
後者は純正bootを確認した後にのみ判断し、現時点ではまだ実行しない。

Junの認証回数を減らす要望に対し、正常系は追加osascript呼出し0を目標としたが、
今回はboot失敗の復旧で新たな管理者処理が必要となった。実際のOS認証prompt数/待ち時間はunknown。
復旧/限定再試行を1つの期限付きhelperへまとめ、実機boot/データ復元結果と認証launch数を分けて記録する。

## 純正復旧と通常boot成功 (10:14 JST)

osascript認証呼出しは、Junの認証完了回答後もroot処理を開始できず待機したため取り消した。
Terminalの固定`.command`からsudo認証を1回行う一時処理へ切替。
Terminal表示で認証完了と処理起動を確認した。パスワードは取得・記録していない。
復旧helperは対象の3設定領域のoriginal/patch hashで個体を照合し、両純正preloaderをDownloadして
named uploadで確認。両方ともraw payloadだけでなく4MiB領域全体が最初の原本と一致した。
設定3領域も元bytesへ戻して各hashを確認し、全5領域の復元を完了した。
miscはこのセッションで実際には書き換えておらず、LK/OS/userdataの書込みも未実施。

通常boot要求後にJunがPowerで起動し、Motorola/Android表示を確認。
[復旧後P0](mobile/moto-g05-p0-restored-20261116.txt)とADBで、元のVVTA35.51-153、
locked/green、OEM permission0、slot_bを確認した。これは純正復旧の実機成功でありLineageOS成功ではない。
純正fastbootへADBから遷移し、product/lock/secure/slotを確認、unlock_ability=0。

新preloader配布物は再投入しない。純正preloaderを保つ限定経路として、認証済み一時処理内の
固定actionを起動し、3設定の原本一致を再確認して設定だけ再適用・readbackする。
通常fastboot reboot途中のMediaTekをhelperが捕捉したため、追加USB操作や管理者認証は不要だった。
予定していたADB待機→poweroff候補は、DA処理中にwait timeoutとなり、poweroffを実行していない。
次は3設定適用後の通常bootと、純正bootloaderのunlock_abilityを確認する。

## 利用量の観測可能性の更新

初期のforecast/model/counter不明という記録は当時のbaselineとして保持する。
後から当該chatの構造化usage metadataを発見し、
[01:11:02Zまでのsnapshot](mobile/usage-snapshot-20261116T011102Z.json)を保存。
記録上の設定はgpt-6.1-sol / mediumで共通。これはlogged configurationでありprovider請求modelの独立確認ではない。
response_idで重複を除き、cacheはinputの内数、reasoningはoutputの内数として扱う。
251 response、重複/conflict0、各usageの総和はlogged thread cumulativeと全counterで一致。
明示binding内に連続checkpointがあるものだけを681/2967へ配賦し、境界/前段はshared/unallocatedへ残す。
子の量を親へ再加算しない。sourceは当該chatのみで、provider-wide/外部review量、金額、active/wait分離はunknown。
初期forecastはactualから遡って作らず、Lineage/Awai実機受入はこのsnapshot時点で0件・未完了。

限定再試行は3領域とも変更コピーへのreadback一致で完了し、純正preloaderは保持したまま。
通常boot要求後に期限付き管理者helperは終了した。次はPowerでAndroidを起動し、
通常権限のADB/fastbootでOEM許可とunlock_abilityを再測定する。
現状態は純正bootchain＋解除用設定3領域のみ変更で、unlock/wipe/Lineage導入はまだ未実施。

## 14:01 JST 再開: factory表示とFastboot接続

Junのボタン操作ではFastbootへ入れず、Androidのfactory mode表示が続いた。
HostでADBが短時間見えた後に消え、property読取りはtransport failureだったため、空値を観測値と扱わない。
USB通知でFile transfer/debugを許可する操作を依頼。
タスク専用LimaのQMP割当を確認するとUSB device/usb-host割当は空で、干渉の原因とは確認できなかった。
未使用の専用VMだけを通常stopし、他3つのrunning VZ guestは保全した。

`adb -s <explicit-target> wait-for-device reboot bootloader`を先に待機させてから再接続すると、
コマンドexit0、hostのFastboot認識、product=lamulと元bootloader版の読取りが成功した。
純正bootloaderはunlocked=no/secure=yesのまま、unlock_ability=0だった。
この段階のbootloader unlock/初期化/OS flashは未実施。

AOSPの[locking/unlocking手順](https://source.android.com/docs/core/architecture/bootloader/locking_unlocking)は、
unlock_ability0ではDeveloper optionsのOEM unlockingを有効にする手順を案内している。
Androidへ通常rebootし、ADB接続時にDeveloper optionsを開く処理を待機。
JunにOEMロック解除のON/gray/項目なしの確認を依頼した。
これは汎用Android仕様と実機の許可0の対応であり、このSKUで設定可能と認定していない。

## 14:30 JST OEM解除の無効状態を実機で確認

JunはOEMロック解除が灰色で、説明に通信事業者・インターネット接続の文言があると報告。
端末ブラウザでページが開けることも確認した。Wi-Fi疎通は解除許可の証明ではない。
ADB待機読取りが成功し、sys.oem_unlock_allowed=0、ro.boot.flash.locked=1、
ro.boot.verifiedbootstate=green、ro.boot.facmode=1を確認。
ro.oem_unlock_supportedは空、global oem_unlock_allowedはnullで、非対応の断定には使わない。
USB構成はadbであり、File transferの常時有効は診断の前提ではない。

AOSP Android15のOemUnlockPreferenceControllerの該当説明は、carrier許可と
base no_factory_reset制約の判定に対応する。端末のdumpsys userの対象フィルタには
no_factory_reset/no_oem_unlockは現れなかったが、vendor実装の原因を確定したわけではない。
IOemLockService公開AIDLで照合した状態取得transaction3/5/6/7は全て権限拒否。
成功した許可値とは扱わない。PDB dumpも内部詳細の読取りは拒否された。
OEM設定変更のBinder呼出し、unlock、wipe、新たなflashは実行していない。

AOSP参照:
- https://github.com/aosp-mirror/platform_packages_apps_settings/blob/android15-release/src/com/android/settings/development/OemUnlockPreferenceController.java
- https://github.com/aosp-mirror/platform_frameworks_base/blob/android15-release/core/java/android/service/oemlock/IOemLockService.aidl

保存済みraw preloaderの静的比較では、active原本330708bytesにVVTAS35.51-153系、
backup原本331428bytesと配布329588bytesにVVTA35.51系のbuild pathがある。
これは配布品と現行原本の差の証拠であり、rollback/DRAM/署名のどれが黒画面原因かは未確定。
配布preloaderは再投入せず、現在の純正bootchainを保持する。
現行の3設定変更だけでは純正bootloaderの許可gateを通過しなかった。
次の実機書込み前に、解除経路と当該firmware/preloaderの互換性を解決する必要がある。
factory表示の解消も未完了であり通常状態の受入とは扱わない。

この診断単位はAWAI-2967/chat01a1e187-0e12-7813-b500-73aa77f2a03e、
開始revision be755bfへ継続binding。logged model/effortは前snapshotから変更観測なし、
今回のtoken counters/費用/active-wait内訳/残forecastはunknown。
古いusage snapshotの測定範囲をこの診断へ拡大したと扱わない。

## 現行XDAの直接確認とv2.0.3の静的調査

Junはpreloader失敗原因の調査と解除・LineageOS導入の継続を明示指示。
Lineage Wikiの機種定義が指定するXDAをChromeで直接開き、OPが現在指定する
tanuki-lamu-v2.0.3を取得した。旧blog/CDN ZIPと同じ現行方式だと扱った説明を訂正する。
[配布物比較](mobile/tanuki-route-comparison-20261116.json)にサイズ・hashと取得元を保存。
OPのpreloaderを変更しない注意書きに対し、配布scriptは両preloaderを書き込む。
この文書とコードの食い違いもJunへ報告済みで、実際の書込み範囲はコードから判定する。
macOS/ARMはOPのサポート外で、現行packageのx86バイナリをMac上で動かさない。
使用候補は既に同一DAでnamed write/RSC writeと読戻しが動作したsource-pinned native2.0。
これは公式Mac対応の主張ではなく、transportを適用した限定候補である。

旧版は3設定変更→preloader→純正LK起動→flashing unlock→kaeru。
現行はpreloader→kaeru両slot→misc→初回再起動→kaeru内からseccfg-unlock。
preloaderとDAとmisc requestは旧・現行でbyte-identical、kaeruとscriptは異なる。
よってpreloader単体の世代差という説明では足りず、旧版で再起動時に残した
純正LKと配布preloaderの組合せ、およびboot時認証の差を調査対象とする。
無出力の黒画面からDRAM・署名・rollbackのどれかを確定する証拠はまだない。
現行kaeru sourceのlamu実装にもcert bypass後のseccfg解除とfactory抑止処理があるが、
current sourceと配布binaryの同一build再現性は未検証。

現行script指定のpairを一回でstaging/readbackする固定helperをprivate領域に準備し、
Python構文・zsh構文を検査。全原本/許容configのlive照合に成功するまで書き込まない。
旧3設定を原本へ戻し、両preloaderと両LKを指定pairへ変更、全readback一致後のみreboot。
miscは保存原本が既にcurrent requestを含むため一致すれば書込みを省略する。
1回のTerminal sudo認証内に、pair試行と固定stock復旧の選択だけを用意。
新たなroot汎用shell/daemon、sudoers変更、lock spoof操作は作らない。
復旧は保存済み両stock preloader/LK/config/misc/seccfgを照合復元する固定操作。
この時点ではhelper未実行、端末への新たな書込みもない。

## 14:45 JST 現行試行は原本照合で停止・今後の計画をLinearへ整理

JunのTerminal認証後、ADBのpoweroffでMediaTek接続を捕捉した。
helperのoem_mfd/proinfo照合は通ったが、FRPは原本/旧patchどちらのhashにも一致せず
CONFIG_MISMATCH frpで停止。最初のmutationより前のguardなので新規書込みはない。
管理者helperは終了し、直近はDA/MediaTek modeでADB/Fastbootなし。

新FRPは同サイズで原本と34bytes異なる。差は先頭digestと末尾付近に限定され、
末尾OEM値は0に戻っていた。AOSP15形式に従う計算で、原本と新読取りのdigestは有効、
旧1byte変更コピーだけ無効。AOSPのenforceChecksumValidityは不一致時に
formatPartitionLocked(false)を呼ぶため、Android起動後の許可0と整合する。
実機内部でその経路が走ったログはないため因果断定せず、黒画面原因とも分ける。
新snapshotと差分metadataはprivateに保持。checksumを無視して再試行しない。

Junの「ここまでをLinearへ記録し今後の計画をまとめる」指示により、
既存AWAI-2967の古いdescriptionを現在状態・調査結果・段階別完了条件へ更新。
[次の計画](mobile-lineage-next-plan-20261116.md)にも同じ内容を保存。
導入は未完了、次は通常起動の復帰確認と現在FRPの新baseline整理から再開する。

## 計画に沿った再開: 通常起動とFRP baseline guardの更新

Junが計画の実行継続を指示。Powerのみの操作でAndroid表示を確認し、起動直後ADBも応答した。
ただしdisplay.id=VVTAS35.51-153-3、slot_suffix=_aで、以前のVVTA35.51-153/_bと異なる。
locked=1/green/facmode=1、電池100%/28.0C。sys.oem_unlock_allowedはこの読取りでは空。
boot完了後の値ではない可能性があるため空を0として扱わない。
その後USB/ADBが消失し、boot完了後propertyと各領域の再照合を待機している。
Android表示だけでbootchain byte同一とは認定しない。

新r2固定helperは、FRPを最初の原本/不正checksumのpatchだけに限定せず、
直近のvalid snapshotのpin済みhashと全byte照合する。checksum有効・末尾OEM0も必須。
全原本・個体・両preloader/LK/seccfg/miscの照合は維持し、FRPそのものはtrialで書かない。
oem_mfd/proinfoの旧factory設定だけ原本へ戻し、現行指定pairをstagingする候補。
preflight不一致時にも、限定認証枠からfixed normal-rebootかfinishだけを選べる。
root汎用コマンドの受入れはない。Python構文/zsh構文は確認済み、r2はまだ未実行。
復旧が必要ならFRPは初回原本ではなくtrial直前valid snapshotを用いる。
新たな端末書込みはこの単位ではない。start revision=a0f8e89、同じAWAI-2967/chat binding。
