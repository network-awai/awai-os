# Awai Otehon installer 0.7.3 配布記録

[日本語の導入手順](install-guide-ja.md) / [AWAI-2921](https://linear.app/kotobalabs/issue/AWAI-2921)

失敗時に処理名、OS のエラー番号・理由、処理済み量、書込み開始の有無を保持・表示します。既報の実機 OSError の原因は未確定で、この版が実機障害を解消したとは認定していません。

- Installer: **0.7.3**
- Build ID: `a73c2f90a6307ce2cb580b0e6bf843161adaec295e72f4795f058c6cc1c2c364`
- NixOS: `26.05pre-git` / Nix: `2.34.8`
- ISO: 8,497,463,296 bytes
- ISO SHA-256: `34b813c2ff6089b008d5901fac32c381c518f4514cd15c9173df0c7cf72ce704`
- [実装 PR133](https://github.com/network-awai/awai-os/pull/133): `5b498b479f3ac01b3c17b7356dee23ab76712f76`
- [同一 ISO の VM 検証](https://github.com/network-awai/awai-os/actions/runs/43673981942): GUI / GUI 無効の物理文字画面とも6項目成功。

## 実媒体

個別 USB の書込み・全長読戻し・eject の結果は [AWAI-2921 の運用記録](https://linear.app/kotobalabs/issue/AWAI-2921)に記録します。使用する媒体の全長ハッシュが上の ISO SHA-256 と一致したことを確認してください。実機の導入完了は別の受入です。

[機械可読の ISO/ZIP・VM・source/artifact 記録](../evidence/otehon-installer-release-0.7.3.json)。

## 起動時の照合

`Text-installer-0.7.3` を選び、画面の **0.7.3 / Build ID a73c2f90a630** を確認します。
オフライン画面は配布記録と照合する方式で、ネットから最新版を自動照会しません。

VM では日本語の実描画、誤った番号・起動 USB・容量不足の拒否、確認から戻る操作、NVMe の書込み・全長照合・UEFI 登録、USB なし初回起動と暗号化状態の冷再起動・解除を確認しました。
実6600Hの導入完了は未観測で、[AWAI-2912](https://linear.app/kotobalabs/issue/AWAI-2912)で継続します。本番 network update enrollment・実電源断・Native 資格は別の受入です。

[0.7.1 の配布履歴](usb-installer-0.7.1.md)は保持しています。

[0.7.2 の配布履歴](usb-installer-0.7.2.md)も保持しています。
