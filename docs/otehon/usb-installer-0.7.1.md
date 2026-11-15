# Awai Otehon installer 0.7.1 配布記録

[導入手順](install-guide-ja.md) / [AWAI-450](https://linear.app/kotobalabs/issue/AWAI-450)

- Installer: **0.7.1**
- Build ID: `7e5cabf799097056fdc3d0a07337909c704ac28cfa11ec4311aa50040aa39cfe`
- NixOS: `26.05pre-git` / Nix: `2.34.8`
- ISO: 8,495,337,472 bytes
- ISO SHA-256: `300692e239e4b94554ca0ca32b305a40262033d24612b302cda4767abf069bdc`
- [ソース PR #118](https://github.com/network-awai/awai-os/pull/118), head `8212f978e071dc12d834255aaa52bc0be7e8c4d2`
- [同一 ISO の GUI / 物理文字画面 VM 検証](https://github.com/network-awai/awai-os/actions/runs/43605076927): 両経路とも6項目成功。

## 表示の照合

起動メニューの `Text-installer-0.7.1`、文字画面の版と Build ID、GUI の版情報を照合します。
この記録は固定した配布版を示します。オフラインのインストーラーは最新 release をネット照会しません。

## 実媒体

KIOXIA TransMemory（61,949,214,720 bytes、serial 末尾 `5987CBC4`）を更新しました。
最初の書込みと同期の後、読戻し途中に Mac が再起動したため、その試行を成功扱いにしていません。
再接続後、書込みを行わない独立した全長読取りで ISO SHA-256 と完全一致を確認し、2026-11-15 09:17 JST に安全に取り外しました。外付け物理一覧からの不在と、writer request の `check` 復帰も再確認しています。

結果: **readback-verified-and-ejected**。USB を抜いて利用できます。

[構造化した配布・読戻し証跡](../evidence/otehon-usb-media-20261115.json)には、CI checkout/source tree、ISO/ZIP/USB hash、実行時間と検証範囲を保存しています。

## 受入範囲

VM では独立した scratch NVMe に対し、シリアルと ERASE の入力、全長 readback、UEFI 起動登録、USB を外した初回起動、暗号化 state 初期設定、cold restart と解除を検証しました。
GUI が無効でも物理 VT1 で操作でき、文字版の REBOOT は実際に再起動要求を発行します。

6600H 実機の firmware/GPU/内蔵媒体、物理電源断、Secure Boot、本番 network update enrollment、Native 資格はこの VM/USB 成功では認定しません。
実PCの内蔵 NVMe はこの Mac から操作していません。

[0.7.0 の配布履歴](usb-installer-0.7.0.md)は過去の証跡として保持します。
