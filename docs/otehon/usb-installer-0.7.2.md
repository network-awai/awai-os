# Awai Otehon installer 0.7.2 配布記録

[日本語の導入手順](install-guide-ja.md) / [AWAI-2914](https://linear.app/kotobalabs/issue/AWAI-2914)

文字版は、シリアル手入力から **ディスク番号の選択 → 別画面で消去を承認**する操作に変更しました。表示・エラー・進捗・電源操作は日本語です。

- Installer: **0.7.2**
- Build ID: `b65ffc3e4c402213ad1fa0bf150975ffb34190d7f6dad98d7296d00999de597b`
- NixOS: `26.05pre-git` / Nix: `2.34.8`
- ISO: 8,496,072,704 bytes
- ISO SHA-256: `359fa6e7055b710d9546778be2a95d6ef3ba4be80a57a711f755ece476467833`
- [実装 PR131](https://github.com/network-awai/awai-os/pull/131): `7253cdfcb6da892892963d4e8b8bfaf2f838a73c`
- [同一 ISO の VM 検証](https://github.com/network-awai/awai-os/actions/runs/43666484029): GUI / GUI 無効の物理文字画面とも6項目成功。

## 実媒体

個別 USB の書込み・全長読戻し・eject の結果は [AWAI-2914 の運用記録](https://linear.app/kotobalabs/issue/AWAI-2914)に記録します。使用する媒体の全長ハッシュが上の ISO SHA-256 と一致したことを確認してください。実機の導入完了は別の受入です。

[機械可読の ISO/ZIP・VM・source/artifact 記録](../evidence/otehon-installer-release-0.7.2.json)。

## 起動時の照合

`Text-installer-0.7.2` を選び、画面の **0.7.2 / Build ID b65ffc3e4c40** を確認します。
オフライン画面は配布記録と照合する方式で、ネットから最新版を自動照会しません。

VM では日本語の実描画、誤った番号・起動 USB・容量不足の拒否、確認から戻る操作、NVMe の書込み・全長照合・UEFI 登録、USB なし初回起動と暗号化状態の冷再起動・解除を確認しました。
実6600Hの導入完了は未観測で、[AWAI-2912](https://linear.app/kotobalabs/issue/AWAI-2912)で継続します。本番 network update enrollment・実電源断・Native 資格は別の受入です。

[0.7.1 の配布履歴](usb-installer-0.7.1.md)は保持しています。
