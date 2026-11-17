# Awai OS: Android AOSP を製品基盤にする

- 状態: **Accepted direction**。owner 指示 2026-11-17。
- 追跡: [AWAI-3007](https://linear.app/kotobalabs/issue/AWAI-3007)。[既存 OS Project](https://linear.app/kotobalabs/project/network-awaiawai-os-ebb92583c4cf) に集約する。
- 決定: 「awai os を android aosp ベースで進める」。先行する「既存 Nix は残す」「Android phone と同じ setup」「Figma design first」の指示も維持する。
- 範囲: Awai OS の phone/desktop 製品基盤。既存 Node/fleet の稼働基盤や Kotoba/Amu/AIUEOS Native の selfhost 契約を一括変更するものではない。

## 決定と責務

| 層 | 所有するもの |
| --- | --- |
| Android AOSP | OS lifecycle、ユーザー・権限、言語・日時、接続、画面ロック、Keystore/FBE の統合、更新・復旧 |
| 機種別 adapter / BSP | kernel・firmware・HAL・GPU・音声・Wi-Fi・Bluetooth・起動経路・実際の鍵保管能力 |
| Awai OS UI | Figma 正本、Welcome/共通 setup、Home、SystemUI/Settings 統合。phone/desktop は共通状態と異なるレイアウト・入力 |
| Itonami app | Manimani/Bots/Apps、ユーザー側 workflow・状態・モデル管理、Awai FS 接続。Android 版は既存 UX を保つ Tauri v3 app と薄い host adapter |
| Awai identity / FS | 検証済みアカウント・端末 enrollment、選択したプロフィールの暗号化転送、保持・同期・復旧。OS PIN や画面遷移を本人認証の代わりにしない |
| 既存 NixOS / Otehon | 稼働済み環境、Node/build/VM 基盤、比較・回復用の保存経路。既存システムを保全し、必要な保守を継続 |
| Kotoba / Amu / AIUEOS Native | 独立した selfhost 経路と認定。Android の成功を Native の成功へ読み替えない |

AOSP を中心に設計し、機種対応に LineageOS の成果を利用できる。LineageOS ブランド、GMS/Google アカウント、Play Store、現行の第三者 Generic PC Live イメージを Awai の必須仕様にはしない。AOSP 採用だけで GMS 互換性や配布資格が得られるとは扱わない。

Otehon の `.cljc`/CLJS 共通核を引き続き使い、Android SDK・ネイティブ adapter・エミュレーターによる実装と検証を進める。Nix は build/host の選択肢として残る。Android 実装を Kotoba Native の CI/build/runtime fallback にしない。

## セットアップとアカウント

Welcome → 言語・地域 → ネットワーク → 日時 → 引き継ぎ／新規登録／後で設定 → プライバシー → Android 画面ロック → Home。対応しない SIM/生体認証は表示せず、利用可能な入力・接続方法を示す。音・モーション・テーマは定義した標準体験を適用し、こだわるユーザーが後で Settings から変える。粒子 UI は保留のまま。

OS 初回設定と Itonami アプリ内の本人認証を分け、Hello・言語・Nix 用ネットワーク設定を二重に要求しない。OS 設定は Android が所有し、通常アプリが provisioning 完了を偽装しない。通信不良時は戻る・再試行・オフライン・後で設定を明示する。

PIN は端末用。Passkey/ウォレットは対応する本人確認手段、スマートフォン連携は新端末を追加する承認経路。選択したプロフィールやデータの移行は別に検証する。秘密鍵のコピーや PIN とウォレット seed の流用をしない。機種別の Keystore/FBE/復旧が確認できるまでは自動暗号化・永続復旧の完了を主張しない。

## 移行と完了判定

| 順序 | 検証単位 | 主な追跡 |
| --- | --- | --- |
| 1 | pinned AOSP/機種 source、artifact・署名、VM と実機の起動・表示・入力・ネットワーク | AWAI-2992 |
| 2 | 共通 setup、標準 Settings との接続、失敗・戻る・再開・Home、Itonami 重複除去 | AWAI-3004 / PR160 |
| 3 | account enrollment、phone 承認、暗号化プロフィール転送、ロック・再起動・復旧 | AWAI-3004、既存 AWAI-165 の復旧責務と整合 |
| 4 | Itonami Tauri app、Bot 作成、モデル取得・読込・解放、生成結果の Awai FS 保存 | AWAI-3001 と各機能 issue |
| 5 | 永続 install、署名付き OS/OTA、更新中断・rollback・紛失復旧、機種別受入 | 未認定のまま具体的な実装/端末 gate に分ける |

既存 Nix の partition・EFI・VM disk・鍵・プロファイル・cron/fleet を保存する。保存先未決定の 6600H に、方針決定を理由として書き込まない。OS 移行が必要な場面では、検証済み backup/restore と対象媒体を具体化する。稼働中サービスの停止や production cutover をこの記録の副作用にしない。

2026-11-17 時点: Generic PC Android の LAN/Live 起動、Android Home/Store/Itonami APK の実装・起動証跡はある。今回の AWAI-3004 では API35 VM の setup UI と native 拒否テストまで進行している。これは custom AOSP ROM の完成、実アカウント移行、永続インストール、signed OTA、6600H の全機能受入を意味しない。方針決定と製品完成を区別する。

## 以前の記述との関係

awai-os `README.md` の「NixOS is the current operating system」と `AGENTS.md` の NixOS 中心の入口は、保持中の旧 artifact については実態だが、今後の製品基盤としてはこの決定が優先する。そのため新しい方針を先頭に置き、既存 Nix の導入・回復手順を履歴として残す。

network-awai-apex ADR0026 D1/D3 の NixOS は先行 Otehon 実装の記録。今回の決定は Awai OS 製品基盤の部分を更新し、安定基盤を使うこと、`.cljc`、local execution、操作ごとの同意、Otehon/Native 分離、既存 Node の運用契約を維持する。upstream ADR 自体の追記は別 PR で整合させ、過去の受入結果を書き換えない。

## 記録

Issue AWAI-3007 / thread `01a1e3f0-1dde-7af3-a093-2a8257f6eb56` / branch `codex/awai-3007-aosp-platform` / base `883fa89bc9c11178eee93de59b86739fb1be7574`。model/settings、estimate/unit、calibrated token forecast、attributable counters、active/wait/cost は unknown。AWAI-3004 の実装・VM 計測をこの意思決定単位へ重複計上しない。
