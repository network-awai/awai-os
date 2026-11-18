# Awai Android と Itonami dapps のアプリ内ストレージ

| 責務 | 正本と組み込み方 |
| --- | --- |
| ファイル、ディレクトリ、履歴 | AwaiFS の [WNFS ライブラリ](https://github.com/network-awai/network-awai-apex/tree/main/otehon/wnfs-cljc)。許可されたクライアントが private tree を開き、CID とブロック、暗号認証を検証する。 |
| 関係、索引、検索 | [Kotobase](https://github.com/network-awai/app-itonami-kotobase) がデータベースの commit/frontier を管理する。アプリは WNFS から得た派生索引をアプリ内で検索し、対象の WNFS snapshot と Kotobase の basis を対応づける。ゲストからの Datalog は [authorized-query](https://github.com/network-awai/app-itonami-kotobase/blob/main/src/kotobase/authorized_query.cljk) の tenant・resources・purpose・basis を使う。検索形式は実際に同梱・検証したアダプターの能力として公開する。 |
| 暗号化ブロックの保存・取得 | [Yataverse](https://github.com/network-awai/app-itonami-yataverse) が CID とバイト列を扱う。Drive の現行 pack プロトコルには [共有クライアント](https://github.com/network-awai/app-itonami-yataverse/blob/main/src/drive-packs.mjs) を使う。 |
| ピア探索、転送、保持 | [Awai Network](https://github.com/network-awai/network-awai-apex/blob/main/docs/awai-fs-storage-architecture.md) の既存経路と保持契約を使う。受領・readback は観測した保存先について記録し、独立レプリカと復旧は別々に検証する。 |

## アプリとホストの境界

- アプリごとに所有者、名前空間、認可を分ける。他アプリとの共有や書き込みには対象を絞った権限を使う。CID の検証、操作の認可、復号鍵の受領、保持条件の成立をそれぞれ確認する。
- Android のアプリ私有領域と Keystore に鍵の保護を委ねる。既存の Awai Shell/Tauri ホスト能力を利用し、ゲストへ任意のファイルパス、コマンド、復号鍵、HTTP IPC を公開しない。
- ブラウザでの外部操作は `kotoba.app.client-runtime.v1` と Kotoba の正本 broker を再利用する。保存、取得、検索、readback は実行するサービス・操作・経路・データ種別を宣言し、必要な操作ごとに利用者の承認を得る。CSP は宣言から作る。アプリ配信元は検証済みアセットの配信を担当する。
- private データは権限のあるクライアントで復号・索引化する。ファイル名、平文、私的グラフ、復号鍵を bytes plane に送らない。外部グラフ連携を加える際には独立した操作宣言と承認が必要。
- 索引は開いた snapshot に固定する。新しい root の取り込み中、古い索引を新しい snapshot の結果として返さない。索引が揃うまでは既知の basis を表示するか利用不能を返す。root と派生索引からの再構築を検証する。

## 現在の実装との接続

[Awai Drive](https://github.com/network-awai/app-drive/tree/main/tauri) と Itonami Yataverse は、現行の bounded owner-store `object-v2` と暗号化 CAR 同期から段階的に接続する。[WNFS 移行設計](https://github.com/network-awai/app-drive/blob/main/tauri/docs/scalable-sync-design.md) の対象は別の wire profile で、既存の receipt と sync 状態は既存形式として読み戻す。

新しいアプリは、実際に使う SDK と能力をアプリの `AGENTS.md` に記録する。WNFS 実装、Kotobase、Yataverse の SDK は owning repository の版に固定する。取得元の revision と digest を記録して、必要な場合にだけアプリの build へ取り込む。ファイルが必要なアプリは AwaiFS、関係を検索するアプリは Kotobase、同期や共有が必要なアプリは Yataverse の該当経路を使い、能力は用途ごとに有効化する。

端末での受入では、アプリ分離、古い snapshot の読み戻し、索引の再構築、通信拒否、CID・署名・暗号認証失敗、オフライン／再起動、許可済みの実データ復元をアプリごとに記録する。
