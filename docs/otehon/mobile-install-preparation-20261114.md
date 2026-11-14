# moto g05: 導入用 artifact の取得と host 準備

[AWAI-681](https://linear.app/kotobalabs/issue/AWAI-681)、2026-11-14。
Jun が前回の解除・LineageOS 導入手順を Lima/Windows 等で進めるよう指示したため、実行準備を開始した。
ここでは取得と host の準備を記録し、端末での成功とは分ける。

## 取得・検証済み

公式 API `https://download.lineageos.org/api/v2/devices/lamu/builds` を再取得し、
最新の同一 build `2026-11-12` の OS ZIP / boot.img / dtbo.img / vendor_boot.img を取得した。
[4 artifact の URL・実バイト数・照合済み SHA-256](mobile/lineage-lamu-verified-20261114.json)を保存。
API の期待値とローカルのサイズ・SHA-256 が4件とも一致した。署名の暗号学的検証・端末適合・起動確認は別段階。
配布物は task worktree の `.agent-output/mobile-install-20261114/` に保全し、Git には入れていない。
`init_boot`・`lk`・`vbmeta` は前回確認した導入手順が要求する追加書込みには含めない。

## host の確認

- macOS arm64、Lima 2.3.0、QEMU 11.1.3。
- 既存の別taskのLima VMは変更しない。専用 `awai-681-mobile-x86` を QEMU/x86_64、2CPU/2GiB RAM/8GiB disk で新規作成した。
  Ubuntu の image は日付付き URL と SHA-256 を指定し、準備開始時点では download 中。
  コンテナ runtime は無効、mount は今回の task 出力のみ、SSH agent と既存公開鍵の取込みは無効。
- 同梱 tanuki の antumbra は x86_64 Linux ELF。aarch64 VZ guest にそのまま配置しても実行環境の証明にならない。
- Lima VZ の USB passthrough は、確認時点で [PR #5770](https://github.com/lima-vm/lima/pull/5770) /
  [PR #5790](https://github.com/lima-vm/lima/pull/5790) が open。installed CLI に phone 用 USB attach コマンドはない。
  今回は QEMU の usb-host/QMP 経路を検証する。raw block-device attach はスマホの MediaTek/fastboot USB 転送の代替にしない。
- 別候補として [Penumbra v1.0.0](https://github.com/shomykohai/penumbra/releases/tag/v1.0.0) の
  `antumbra-darwin-aarch64` を取得し、GitHub release API の期待 SHA-256
  `2737efd7cdd0a0e8b2afe25b1b14cf1d2af3bca1ed1a9473fcdf647b44fbb0a7` と一致を確認。
  macOS で `--help` と `x-flash --help` が exit 0。これは起動とコマンド表示のみで、USB通信・読み書き成功ではない。
  tanuki 同梱版とは別versionのため、互換性未確認のまま差し替えて書かない。
- Wine は未導入。Windows executable が起動することと MediaTek USB driver が使えることは別なので、
  Linux経路を調べずWineだけを導入する手順にはしていない。

## 未達と再開条件

準備開始時、ADB と IOUSB の両方で moto は検出されなかった。
接続とバックアップ状況を Jun に依頼済みで、回答待ち。端末への unlock/flash/wipe は実行していない。

接続後、対象SKU/current firmware/bootloaderを再測定し、未変更の原本バックアップと純正復旧物の
取得・照合方法を確認する。その後に USB の Android/MediaTek/fastboot 各 mode と再列挙を検証する。
USB転送や firmware 適合が未確認のまま、書込みを始める tanuki 全体を起動しない。
前回の同梱 ZIP は再照合済みで、取得物の SHA-256 は変わっていないが、独立した配布者期待 digest は未確認。
