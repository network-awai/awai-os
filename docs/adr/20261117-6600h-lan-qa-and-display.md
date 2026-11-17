# ADR: 6600H の LAN 起動・本人認証・表示受入を分離する

- 日付: 2026-11-17
- 状態: 既存 owner 方針と今回の運用判断の記録。表示修正の具体方式は未決定。
- 追跡: [AWAI-3030](https://linear.app/kotobalabs/issue/AWAI-3030)、[AWAI-3049](https://linear.app/kotobalabs/issue/AWAI-3049)
- 上位: [AOSP platform decision](../otehon/aosp-platform-decision-20261117.md)

## 背景

本人の Wi-Fi 選択や Passkey 署名を毎回待つ回帰テストでは、実機 debug が律速する。一方、本人認証の無効化や完了フラグの書換えは、通常アカウントの保護と AOSP の責務を損なう。

起動サービスが参照した作業領域の消失により LAN 配信が壊れ、OS 再起動後のアプリ保持確認へ到達できなかった。配信を復旧すると Android の永続状態と実推論は確認できたが、利用者の HDMI 画面は空のままだった。非表示の display0 の成功を、可視 desktop の成功に置き換えることはできない。

## 決定

1. 本人の認証情報は保持する。通常アプリを変更せず、別署名・別 UID・testOnly・ネットワーク権限なしの QA pair に限定して、ソフトウェア署名を実 verifier に通す。QA に本人の連携承認を要求しない。実本人 enrollment の証明は別。
2. LAN 配信は immutable artifact pin、実参照パス、HTTP/TFTP、実クライアント取得、新 boot ID の順に検証する。起動依存のファイル・task output は worktree GC の対象外。今回の互換 symlink 復旧は暫定復旧であり恒久配置の完成ではない。
3. アプリ保存、OS 再起動、推論、ユーザー可視表示、製品 OS 認定を別の acceptance とする。途中失敗と続行を消さない。CDP の結果だけで物理モニター表示を認定しない。
4. AOSP が setup/provisioning/Home を所有する。アプリの setup 完了や検証済み QA セッションで `device_provisioned` / `user_setup_complete` を偽装しない。画面番号を固定すれば解決するとも断定せず、実接続・主画面・secondary policy を検証する。
5. Nix desktop route は deprecated のまま。共有 p2 内の現 Android images、認証、ESP、暗号化領域を保護し、旧 store 隔離を p2 全体削除へ拡大しない。

## 結果と残り

実機では途中の transport エラーからの続行を含め QA18項目が成功し、通常 app/peer/provisioning witness は一致した。HDMI側の表示は未達で AWAI-3049 に継続する。新しい表示 policy、製品 ROM、FBE/電源断、オフライン EFI、画像・音声生成の成功をこの ADR で承認・認定しない。

今回の復旧で不要になったのは毎回の本人承認であり、物理リンク・firmware 操作を行える遠隔基盤がない場面の人手までは保証しない。根拠と再開手順は [時系列・工程表](../otehon/6600h-lan-qa-status-20261117.md)を参照する。
