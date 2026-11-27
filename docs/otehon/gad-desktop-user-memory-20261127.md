# gad Desktop user 次回ビルドのメモリ枠と実測手順 (Item #620)

実行中の gad AWAI-3600 候補 65c5c42 の出荷検証とは独立した、次回以降の
Desktop user ビルド起動設定の作業。AOSP フルビルドは実行しない。
本書の数値のうち、再実測の記載がないものはタスク受領時の organizer 提供値
（机上）であり、repo 内で再検証したもの（実測）と区別する。

## 1. 実入口の確認（repo 内、実測）

Desktop user の実ビルド入口は
`scripts/operator/virtio-dryrun/build-inside.sh` である。並列度に関する
既存の指定は repo 内に存在しない：

- v1: `run m target-files-package otatools diskimage-vda`（素の `m`、
  Soong 既定並列）
- v2: `run BUILD_NUMBER=awai-g2-v2 BUILD_DATETIME="$(date +%s)" m target-files-package`
- `repo sync` は `-j4` 固定（変更なし）
- `gad-fast-build-profile.env` の `-j20`、および `-j8` / `-j4` を渡した
  gad 側 launcher 設定は repo 管理外である。架空の入口ファイルは足さず、
  本 PR では入口側が任意の明示値を検証付きで受け取れるようにした
  （§3）。gad 側の最小変更案は §5。
  read-only 照合の受領値（repo 外、机上）：現候補の host 管理入口
  `inside-product.sh:41` は実際に `m -j8` と明示し、
  `inside-product-resume.sh:62/68` は `-j1` の後に `-j4` と明示している。
  よっていずれの repo 側変更も当該独立 launcher には自動反映されず、
  次回反映には §5 の host 側差分が別途必要である。
- 参考：`scripts/operator/same-build/build-inside.sh` は
  `JOBS=min(nproc, mem_GiB/4)` のメモリ bounded 式を持つが、対象が
  lamu/Generic 系であり、virtio Desktop user の crosvm rustc ピークとは
  ワークロードが異なるため、そのまま転用しない（机上判断、§2）。

## 2. 枠と既定値（机上と実測の区分）

| 項目 | 値 | 区分 |
| --- | --- | --- |
| Linux MemTotal 48,947,684 kB（46.68 GiB）、AMD iGPU に 48.0 GiB 予約 | 受領値 | 机上（organizer 提供、repo 外） |
| Docker 34 GiB RAM + 26 GiB swap（memory+swap 60 GiB） | 受領値 | 机上（repo 外） |
| `-j8`：Soong/Kati 後、Ninja 74% で crosvm/libdevices の rustc が cgroup OOM、実働 2:25:48 | 受領値 | 実測（gad、repo 外）。完走せず |
| 既存 out から `-j4` 再開：20:22 JST 時点 48%、OOM 0、peak 34 GiB | 受領値 | 実測（gad、repo 外）。完走は未確認 |
| `-j20`（既存 `gad-fast-build-profile.env`）は Desktop user 枠で使用不可 | 受領値 | 実測扱い（OOM 経験則、repo 外） |
| 次回既定：現行 34 GiB 枠は `-j4` から（明示値） | 本 PR の提案 | 机上 + 上記実測に整合。完走による裏付けは次回 |
| OOM の原因帰属 | `-j8` での 34 GiB cgroup OOM | 実測（host 側 `inside-product.sh:41` の明示 `-j8` と対応）。repo の通常起動経路（素の `m`）の問題ではない |
| `same-build` 式 `mem/4`（34 GiB → 8）は crosvm rustc には適用しない | 本 PR の判断 | 机上。34 GiB は `-j4` 再開 48% 時点の cgroup peak 実測値であり、÷4 の job 当たり割算で予算化しない（訂正：前版の「約 8 GiB/job 示唆」は単純推定であり撤回する。rustc spike は一過性で out 状態・進行度に依存するため、次回は §6 の段階検証で実測裏付けを取る） |

## 3. repo 側の変更（本 PR、実測：局所 dry-run + 単体 42/42）

`AWAI_M_JOBS` 未設定時は従来の素の `m` とバイト同一のコマンド列を出す
（既存テストが保証）。明示時は v1・v2 の両 `m` に `-jN` が付く。

- `AWAI_M_JOBS=4`：1..64 の整数検証。不正値はビルド前（kit 取得前）に
  exit 2 で拒否。次回 gad は `AWAI_M_JOBS=4` を明示する。
- `AWAI_RUST_PREPASS_JOBS=1` + `AWAI_RUST_PREPASS_TARGETS=<host で確定した scope>`：
  v1 前に一度だけ低並列で先行ビルドし、rustc ピークを全並列のリンク
  ストームから切り離す。`TARGETS` は空白区切りの Soong module/goal 名のみ
  を受け、先頭 `-`（option）や shell メタ文字は拒否し、引数配列のまま
  `m` に渡す（`run` の文字列再解釈を経由しない）。入力は単一行に定義し、
  改行を含む値は拒否する（`read -ra` が LF 後を黙って捨てるのを防ぐ）。
  `TARGETS` 未確定のまま jobs だけ渡すと拒否する。並列度の 1..64 検証は
  桁数制限（最大 2 桁）＋範囲検査であり、整数の桁あふれに依存しない。
  目標名はソースツリーを持つ host 側で確定させる（repo 内に crosvm
  モジュール名の実体は無く、例示値は机上）。
- `AWAI_CCACHE_STATS=1`：v1・v2 の各 `m` 直後に `ccache -s` を出す。
  既定 off。C/C++ の cold/warm 測定専用であり、Rust 対策とは連動しない。
- `AWAI4089_STAGE=<name> <UTC> epoch=<unix>`：全 stage 行に epoch を付与。
  工程別時間は epoch 差分で再現可能に算出する（§6）。
- `AWAI4089_M_JOBS=<値> RUST_PREPASS_JOBS=<値> CCACHE_STATS=<値>` を
  1 行で記録する。

戻し方：4 変数をすべて未設定にすれば従来動作（素の `m` 単発、stats なし、
pre-pass なし）に戻る。ビルド内容自体の変更は無い。

## 4. 現行停止条件の維持（repo 外、変更なし）

以下は gad 側の現行条件であり、本 PR は repo 側に新しい閾値を埋め込まない。
次回も維持する：34 GiB 枠、memory+swap 60 GiB、PSI、空き 35 GiB、排他。
`AWAI_VIRTIO_DEADLINE_SECONDS`（最低 28800）の guard も変更なし。

## 5. 次回 candidate launcher の最小手順（gad 側、repo 外）

訂正：現候補の host 管理入口 `inside-product.sh` /
`inside-product-resume.sh` は `m` を直接呼ぶ独立スクリプトであり、本 PR
の env 受け口（`AWAI_M_JOBS` 等）はそちらに伝播しない。よって前版の
「既存行の `-j8`/`-j1`/`-j4` を削って env へ寄せる」方針は危険であり
撤回する。既存候補スクリプト（`-j8` 単発、`-j1`→`-j4` 再開の記録を含む）
は当該候補の証跡として保持し、編集しない。

次回は新規 candidate launcher（新規ファイル。前回物の複写を起点とする）
にのみ以下を書く。概念ではなくファイル/引数の境界である：

- build 本体行に `m -j4 <targets...>` を明示する（env 委譲にしない。
  `AWAI_M_JOBS` との二重指定はしない）。
- Rust pre-pass を採る場合のみ、その直前に `m -j1 <認定 scope>` の 1 行を
  置く。scope は host のソースツリーで認定した Soong module/goal 名に
  限る（単一行。未認定の間は pre-pass 行を書かない）。
- 戻し方：新規 launcher を使わず、証跡として保持した前回候補の起動手順
  （既存スクリプト）に戻す。既存スクリプト自体に手を入れないため、戻しは
  「使うファイルを戻す」だけで完結する。

なお VKE 出荷経路 `virtio-job.sh` の env 列挙は 067352dc 時点で新ノブ
（`AWAI_M_JOBS` / `AWAI_RUST_PREPASS_*` / `AWAI_CCACHE_STATS`）を伝播して
いない。本 PR ではガードや出荷基盤を拡張せず、検証は repo の
`build-inside.sh` 直接起動（局所 dry-run＋単体、§8 1–2）に限る。

`RELEASE_TYPE=user`、`BILLING_ALLOWED=1` + `OWNER_APPROVED=1`、
`AWAI_VIRTIO_DEADLINE_SECONDS`、apps mode の明示など既存の必須入力は
そのまま。`release-clean`（fresh out）と増分 out（既存 out 再開）を同一
系列で混ぜないこと：どちらで走ったかを、実行コマンド行と
`AWAI4089_M_JOBS` 行の両方で記録する。比較は同一条件内でのみ行う（§6）。

## 6. 再現可能な工程別測定（固定比較 + UMA 4 GB 後の段階検証）

オーナー決定（65c5c42 の独立 QA 終了後、gad の BIOS UMA を 4 GB に下げ、
次回ビルドの実時間と同条件工程を比較する）を受けた手順。UMA 変更自体は
QA 終了後の別作業であり、本 PR は手順だけを用意する。現在の 34 GiB
プロファイルの安全な挙動は変えない（既定は素の `m` のまま）。

固定比較用の記録項目（毎回同一に固定し、変えたものだけを記録する）：
同一入力（kit SHA、pinned manifest SHA、APK pins、`AWAI_FEED_URL` 以外の
B2 値を含まない）、同一 out 状態（release-clean か増分か）、同一 cache
状態（§7 の cold/warm）、同一並列度（新規 launcher の明示 `-j4` 行。
repo 経路の場合は同等の `AWAI4089_M_JOBS` 行）、同一 cgroup 枠
（RAM/swap 上限）、`AWAI4089_STAGE` epoch 差分による工程別時間、
cgroup peak（`memory.peak` / `memory.swap.peak` の host 側読値）。
直接 `m` を呼ぶ新規 launcher では stage 行が出ないため、工程区切りは
実行コマンド行の記録で代替する。

再起動後の実測 MemTotal に応じた段階検証：

1. 再起動後に `MemTotal` を実測し、cgroup 枠と合わせて記録する。
2. まず明示 `-j4`（repo 経路の場合は同等の `AWAI_M_JOBS=4`）のまま v1→v2
   の完走と OOM 0 を確認する（現行 34 GiB プロファイルの安全側。`-j4`
   再開 48% の続きではない新規完走をもって裏付けとする）。
3. 枠が拡大した場合のみ、同一 out 起点で `-j6` → `-j8` の順に一段ずつ
   上げ、各段で OOM 0 と peak 余裕を確認してから次段へ進む。各段は
   release-clean／増分を混ぜず、cold/warm（§7）も段ごとに分離する。
4. どの段でも cgroup OOM・PSI 悪化・空き 35 GiB 割れが出たら即時停止し、
   一段下の値を次回既定として記録する（§4 の停止条件が優先）。

## 7. C/C++ ccache の cold/warm 設計（Rust OOM 対策と分離）

- cold：空の `CCACHE_DIR` + release-clean out（または増分 out の cold 側と
  明示）から開始し、`AWAI_CCACHE_STATS=1` の `ccache -s`（hit/miss 率）と
  §6 の工程別時間を取る。
- warm：cold 済みの `CCACHE_DIR` を再利用し、同一 out 起点で同じ 2 点を取る。
- 変えるのは cache 状態のみ。並列度（`AWAI_M_JOBS`）、pre-pass の有無、
  out の clean/増分の別は段内で固定し、混ざったら系列を分けて記録する。
- Rust pre-pass の成否と ccache hit 率は別系列の指標として扱い、互いの
  効果として計上しない。

## 8. 次回の小規模検証手順（AOSP フルビルドなしで済む範囲）

1. 本 PR の局所 dry-run：既定（素の `m`）と明示 override
  （`-j4`、pre-pass、ccache stats）の 2 通り — 実測済み（§3）。
2. 単体：`node --test scripts/operator/virtio-dryrun/virtio-dryrun.test.mjs`
   42/42 — 実測済み。検証は `build-inside.sh` 直接起動に限り、
   `virtio-job.sh`（VKE 出荷経路）の env 伝播は対象外であることを確認済み。
3. 次回 gad 枠での小規模実測（本 PR の範囲外、host 側）：
   新規 launcher の明示 `-j4` で v1 のみ走らせ、実行コマンド行・cgroup peak
   を §6 の書式で記録する。repo 経路の場合は `AWAI_M_JOBS=4` +
   `AWAI_CCACHE_STATS=1` とし、`AWAI4089_STAGE` epoch 差分・`ccache -s` を
   併せて取る。pre-pass の目標 scope はこの時点でツリー確認のうえ初回投入
   し、単独の効果として記録する。
