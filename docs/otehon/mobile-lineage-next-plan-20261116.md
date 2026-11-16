目的: moto g05 (XT2523-5 / retjp / lamul) を解除し、同一buildの公式LineageOSを導入・実機検証する。Awai Android基盤はその後に検証する。NixOSの実機起動とは区別する。Junは端末内データの全消去を了承済み。2026-11-16 JST更新。

## 最新状態: 解除・ZIP導入成功、LineageOS初回起動待ち

- 現行tanuki v2.0.3の指定pair（両preloader＋両kaeru）を書込み・読戻し検証し、Fastboot/kaeru起動成功。
- 現在のOEM metadataを保持し、既知factory bytes4096/552だけ1→0。FRPはvalid snapshotから全byte不変。
- kaeru v2.0.0-g65a7db9-dirty、product lamul、slot_a。seccfg-unlock成功後にFastbootを再起動し、unlocked=yes / is-spoofing=0を再確認。
- 管理者trial/recovery controllerは終了。検証済みboot/dtbo/vendor_bootのflash成功、JunがLineage Recovery起動とfactory resetを確認。
- host sideloadは900秒監視期限で終了し、成功終了ログはない。その後Junが端末側Install completed/status0/追加パッケージ確認を報告。hostとdeviceの証拠を分けて保持する。
- 追加パッケージ用Recovery再起動はNo、Reboot system nowでOS初回起動へ進む。ZIP再送や追加flashはしていない。
- 同じ配布preloaderが完全pairで起動したため、「この個体で当該preloaderが単体として起動不能」という説明は成立しない。前回との差はLKの組合せ・factory flags・起動順であり、失敗した内部関数は未同定。
- 次はLineageOS初回起動→画面/touch/Wi-Fi/充電/再起動の実機受入。

## 解除前の観測・復旧証跡（以下は過去の記録）

- 純正Android15 VVTA35.51-153。最後のADBでlocked=1 / green / OEM permission=0 / facmode=1。ブラウザのインターネット疎通をJunが確認。OEMスイッチは灰色で通信事業者・ネット接続の説明。
- ADBから純正Fastbootへ移行成功。実測unlocked=no / secure=yes / get_unlock_ability=0。解除・wipe・Lineage image書込みは未実施。
- 原本17領域 (328,728,576bytes) を保存・hash照合。両preloader・LK・seccfg・config・boot stackの原本と復旧証跡はprivate task領域に保持。
- 旧blogの配布preloaderを両boot areaへ書込み、payload読戻しは一致したが、その後の純正LK起動で黒画面。両純正preloaderと3設定を全byte照合して復元し、純正Androidの起動をJun/ADBで確認済み。
- その後、純正preloader/LKを保ち3設定だけ再適用したが、解除許可0のままfactory表示になった。
- 現行v2.0.3試行の最初の原本照合でFRPの変化を検知し停止。今回のhelperは新たな書込み・rebootをしていない。管理者helperは終了。直近USBはMediaTek読取りモード、ADB/Fastbootなし。

## 調査結果と未確定事項

1. Lineage Wikiが指すXDA OPの現行版はtanuki-lamu-v2.0.3。旧blog/ZIPを現行方式と同一視した説明を訂正。OPから取得したpackage SHA256: d0a89f5f293c0309150af6d2cd56db203d280665cd45c0106c06add737361555。これは取得後のlocal hashで、独立publisher digestは未取得。
2. コード上の重要差: 旧版は3設定→preloader→純正LK起動→flashing unlock→kaeru。v2.0.3はpreloaderとkaeru両slotを全て書いてから初回起動→kaeru内のseccfg-unlock。preloader/DA/misc requestは同一byte、kaeru/scriptは異なる。組合せ・起動順は再試行の根拠だが、黒画面原因の確定ではない。
3. OPの「preloaderを変更しない」注意と配布scriptの両preloader書込みは食い違う。Junへ報告済み。実際の書込み範囲は検査したコードから判断する。Mac/ARMはOPサポート外。source-pinned native2.0+libusbでの既存read/write成功は限定transport実績であり、公式対応とはしない。
4. 新読取りFRPは原本から34bytes差（digest領域と末尾付近）。OEM末尾値は0。原本/新読取りのSHA256チェックサムは有効、旧1byte変更コピーは無効。AOSP15はdigest不一致でFRP再初期化＋OEM falseとする。許可が戻る現象と整合するが、端末内部ログによる原因確定ではない。黒画面問題と混同しない。
5. DRAM互換性・署名/証明書検証・rollbackのどれで起動失敗したかはunknown。正常動作中に追加の破壊的実験を重ねない。

## 今後の実行計画と各段階の完了条件

- [x] 1. 原本照合で止まった端末を通常起動へ戻し、純正bootchain/lock/factory表示を再確認。全原本と今回FRP snapshotを保持する。
- [x] 2. FRP差分の形式とchecksum、現在のconfig/preloader/LK/seccfgを再照合。動的に変わるFRPを旧hashへ盲目的に戻さず、新baselineと変更範囲を明示して固定helperを更新する。factory設定を通常へ戻す条件もここで決める。
- [x] 3. 現行配布物の完全な組合せと当該firmwareの互換性を評価。黒画面仮説の根拠・未確認範囲を記録し、復旧allowlist/通信/電池を確認。root処理は固定操作・期限付き、汎用daemonやsudoers/NOPASSWDを追加しない。可能な範囲で1認証に試行と復旧をまとめる。
- [x] 4. 採用した現行経路を1回staging。変更前の個体/領域照合、各書込みの読戻し、必要な組合せが揃うまでrebootしない。成功条件はFastboot/kaeru起動と実測unlocked=yes。lock spoofは使用しない。失敗したら保存済みstock bootchain/config/seccfgへ照合復旧し、Android起動を確認する。
- [x] 5. 真の解除確認後だけ、同一buildでhash確認済みLineageのboot/dtbo/vendor_bootを公式lamu手順で導入。Recoveryでfactory reset→署名ZIP sideload。利用者の消去了承は取得済みで再要求しない。新たな実機ボタン操作が必要な段階だけ案内する。
- [ ] 6. Lineage起動、build/lock state、画面・touch、Wi-Fi、充電、通常rebootを確認する。SIM/通話等は未検証のまま区別。Awai Android integrationはOS受入後に独立検証し、NixOS成功と表現しない。

## 作業・計測binding

追跡は既存AWAI-2967を継続。親AWAI-681は準備PR98のmergeをもってDone（実機導入完了の意味ではない）。現在のdraft PR141は調査・host/backup/復旧証跡であり、導入済みではない。

- repo network-awai/awai-os、branch codex/awai-681-g05-install-20261116。chat/run 01a1e187-0e12-7813-b500-73aa77f2a03e。今回unit開始revision 8d33ea5、現行比較unit 8a24db0。
- 配布物・private原本・ログ・一時helperはtask worktreeに保持。unique evidenceがあるためworktreeは削除しない。
- configured model/effortは既存local snapshotでgpt-6.1-sol / medium。現在請求model identity/今回token counters/cost/active-wait/remaining forecastはunknown。過去のusage snapshotのcoverageを今回へ拡大しない。issue estimate=null、unit unknown。tokensからETAや進捗率を算出しない。

## 参照

- Draft PR: https://github.com/network-awai/awai-os/pull/141
- Lineage device source: https://github.com/LineageOS/lineage_wiki/blob/main/_data/devices/lamu_variant3.yml
- 現行解除OP: https://xdaforums.com/t/unlock-bootloader-motorola-motorola-g15-power-g05-e15-lamu-lamul-lamulg.4780735/
- AOSP15 checksum処理: https://github.com/aosp-mirror/platform_frameworks_base/blob/android15-release/services/core/java/com/android/server/pdb/PersistentDataBlockService.java
- Tracked journal: docs/otehon/mobile-lineage-session-20261116.md
