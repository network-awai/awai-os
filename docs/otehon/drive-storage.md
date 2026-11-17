# Awai Drive の Otehon 保存経路

AWAI-2930 の対応範囲と再現手順です。最新の source/CI/merge 状態は末尾の
Linear 課題を参照してください。実機配備や分散 E2EE の認定とは分けて扱います。

## 保存先

新しい 6600H installed profile は、暗号化 state を解除した後に、ユーザーの
`~/Awai` を起動します。初期ホームの Documents と GTK ファイル選択の
Awai Drive ブックマークがこの保存先を使います。既存の `user-dirs.dirs`、
ブックマーク、非空のマウント先を置き換えず、既存データを移行しません。
`awai-drive` でネイティブのファイル画面を開けます。

起動順は、既存の `otehon-state` → private state の検証と準備 →
単一 writer の Awai volume → 同じ利用者だけが使える FUSE mount です。
状態は暗号化された home bind 内の `~/.local/state/awai-drive` に置きます。
`/var/lib/otehon` の root 専用権限は緩めません。解除されていない場合、
平文の root disk に代わりの volume を作りません。

## 対応範囲

既存の bounded Linux volume v1 をそのまま使います。**1ファイル 8 MiB、
合計 64 MiB、空ディレクトリ作成は未対応**です。大容量ファイル、汎用 POSIX、
ホーム全体の移行として扱わないでください。Downloads・ブラウザの profile・
OS の root/boot をこの経路へ移しません。

保存は VFS cache から volume へ非同期に渡ります。単なる close/fsync を
backend の永続化 receipt とみなしません。転送に失敗した dirty cache は
暗号化 state に保持されるため、手動削除しないでください。cache の退避を
分散の保持条件成立・backup 完了と読み替えません。

`awai-drive --status` は owner 専用 Unix socket から未転送/転送中/エラー件数を
取得します。欠測は unknown とし、`transfer-idle` でも backend readback や
分散保持成立の receipt を発行しません。RPC を TCP に公開せず、転送エラーの
詳細は暗号化 home の private log に置き、システム journal にファイル名を送りません。

この候補のローカルデータは LUKS で保護されます。owner envelope・Passkey・
private metadata の E2EE、独立 pin/replica/repair、地域最適化配信は未接続です。
外部 storage 宛先を設定せず、平文 Pack を他人のノードへ同期しません。
Forest 圧縮 Pack と WNFS PrivateForest は別の仕組みです。

## source と再現

`otehon/drive/vendor/apex/source.json` は owning repository の immutable
revision と全 snapshot ファイル SHA-256 を持ち、Nix package は全件照合します。
`.cljc` の volume/codec/ID を独自実装せず、Otehon に許可された Node/nbb を
Nix で固定します。Native gate/build/runtime の依存ではありません。

Linux Nix/KVM builder の repository root で:

```sh
nix-build otehon/drive/check.nix --out-link result-drive-vm
```

この VM だけの公開 fixture key で追加ディスクを LUKS 化し、実際の FUSE 保存・
rename と backend readback、全 storage process 停止、検証済み cache の保全退避、
guest 再起動、empty VFS/派生 cache からの同一 bytes 読取りを検査します。
committed Pack 破損時は初期化・旧 root rollback で成功させません。
fixture key は実機の鍵や installer に入れません。

この試験は独立ノード喪失・実媒体電源断・remote-only 復元の代替ではありません。
別端末 agent は [AWAI-2930](https://linear.app/kotobalabs/issue/AWAI-2930) の
最新コメントと PR head/CI を再取得し、専用 worktree で同じ gate を実行してください。
本番の cache・鍵・mount を試験用 namespace と取り違えないでください。

### 接続停止時の保存先

`~/Awai` は private FUSE mount の接続後だけ公開する管理 symlink です。
通常のサービス停止では公開を取り下げてから unmount するため、停止中の書込みを
通常ディレクトリへ黙って保存しません。既存の同名ファイル・ディレクトリや不明な
symlink は上書きせず起動を拒否します。予期しない private mount 下のファイルも
削除しません。管理者による直接 unmount や kernel 障害との原子的連動を保証する
ものではありません。credentials は2値一致・固定形式を起動前に検証し、部分書込みを
検出した場合も再生成せず拒否します。
