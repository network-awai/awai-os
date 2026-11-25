# 7735HS 装置実測ステータス 2026-11-23（item 166）

この文書は実測のみを記す。推測や「確保した」「到達した」を断定しない。
日付は **2026-11-23（JST）**。実測はこの worktree の operator Mac から実行した。

## 1. 実測（コマンド + 出力）

| 項目 | コマンド | 実出力 |
| --- | --- | --- |
| Vultr 認証情報 | `security find-generic-password -s vultr-awai-build -a awai` | `SecKeychainSearchCopyNext: The specified item could not be found in the keychain.` exit **44** |
| 署名成果物（target-files zip / disk-vda.img / OTA zip） | `find /Users/node -maxdepth 4 ...` | **0 件**。引っかかったのは Android エミュレータ AVD の `*.img` のみ |
| AOSP ソースツリー | 同 `find`（`lineage_*` 等） | **0 件** |
| この Mac の余量 | `df -h /` / `sysctl -n hw.ncpu hw.memsize` | 空き **11 GiB** / 10 core / **17179869184 bytes = 16 GiB RAM** |
| OTA パイロット feed の生死 | `curl` `/v1/pc/pilot/`、`/v1/pc/pilot/virtio_x86_64/`、`/v1/pc/pilot/virtio_x86_64/123456/builds.json` | 3 本とも **HTTP 404 / 27150 bytes**（汎用 Not Found ページ。エンドポイントは無い） |
| 10.77.0.0/24 の有無 | `ifconfig` / `ping -c2 -t2 10.77.0.2` | この Mac に **10.77.0.1 インターフェースなし**。`ping` は 100% loss（2 packets, 0 received） |
| `sgdisk` の有無 | `which sgdisk` | **無し**（exit 1） |

補足: ネット自体は生きている（このセッションで `https://github.com/` に 200、
`ota.awai.network` ホスト自体は応答し上記の汎用 404 を返す）。
はずの経路の到達確認・サーバ到達ではない。

## 2. ホスト別コマンド確定表（5ホスト）

凡例: **オーナー** = 人の手（課金・鍵・消去・deploy は bot が持てない）。
**bot** = オーケストラから操作可能なエージェント作業。ただし最終確認は owner。
各行の前提が満たされて初めて次へ進める。

| # | 工程 | ホスト（5本のどちらか） | 誰の手 | 前提 | コマンド |
| --- | --- | --- | --- | --- | --- |
| 1 | AOSP ビルド（signed target-files + stock disk まで） | **Linux ビルドホスト** | bot（owner が開錠） | **有料ビルドの owner 可否**（既定は free-only policy。Vultr で課金が発生するなら発注前に確認）。認証情報は Keychain に無い（exit 44）ため、owner が実体を渡す | `m target-files-package diskimage-vda otatools`（`android/desktop/target-files/evidence/target-files-20261119.json` の手順）→ 署名済み target-files ZIP + SHA-256（signing record）+ stock disk SHA-256（build record）を取り出す |
| 2 | 署名（zipsigner / release） | **署名するオーナー Mac** | **オーナーの手**（鍵を bot が触らない） | 1 が完了。鍵 basename + cert.pem の実体が signing environment にある | 署名完了 → 署名済み ZIP の SHA-256 を signing record に記録 |
| 3 | install image 組立（`make-tf-disk.sh`） | **Linux ビルドホスト** | bot | 1,2 完了。`AWAI_ANDROID_HOST_OUT` = `$OUT_DIR/host/linux-x86`（build_super_image/lpmake/simg2img 入り） | `bash android/desktop/pc-ab-device/make-tf-disk.sh $SIGNED_TARGET_FILES $STOCK_DISK $INSTALL_IMAGE`（`install-media.md`）。SHA-256 を release manifest に記録 |
| 4 | OTA generate / verify | **Linux ビルドホスト**（releasetools 同梱） | bot | 1–3 完了。`ota_from_target_files` と `check_ota_package_signature` が PATH 上。鍵 basename + `--certificate-sha256` | `python3 android/desktop/pc-ab-device/updater-feed.py generate-ota ... --require-streaming` → `verify-ota`。make-index はこの後 index publish で使う |
| 5 | index publish | **10.77.0.1 を持つホスト**（ota-feed Worker / yataverse 経由） | bot（deploy は owner 確認） | OTA feed 参照だけ（`deploy/ota-feed/` は別 worker が実装中 — 本書は参照 1 行で触らない）。data は yataverse（Worker 内 blob は ingest 済み） | `scripts/publish-index.py`（`updater-feed.py make-index` 再利用）→ index を publish → `/v1/pc/pilot/{device}/{incr}/builds.json` で 200 を実測 |
| 6 | `awai-pc-install.py plan`（対象 disk / image） | **NVMe を付けた Linux ホスト**（sgdisk 入り） | bot | 3 の install image が存在すること。**sgdisk が無いこの Mac では plan すら走らない**（§1）。**apply は本 plan で実行しない** | `awai-pc-install.py plan <disk or image> <install image> [--userdata-gib N]`（plan は何も書かない） |
| 7 | PXE 前段（serve + ログ集約） | **10.77.0.1 を持つホスト**（この Mac または同等の direct-LAN ホスト） | bot | 10.77 直接 LAN 復旧（`ping 10.77.0.2` が通る + 10.77.0.1 を割る）。実測は §1 | `serve-install.mjs <dir> <manifest.json>` on 10.77.0.1:18091 / `serve-artifacts.mjs` on 10.77.0.1:18091（RAM Live では 18095 collect-boot-log を並走） |
| 8 | PXE install profile 組立（iPXE + initrd） | **10.77.0.1 を持つホスト** | bot | 前段完了。install profile は firmware route の独立した artifact dir（`switch-route.mjs` で active 先を切り替え、終わったら戻す）。`patch-ipxe.mjs install` は 5 既存 entry の code path に触れない | `patch-ipxe.mjs <pinned ipxe.efi> install <out.efi> erase 500118192`。`init-install.sh` を `/init` とし、`/awai/install.pins`（template 通り）に SHA-256/bytes を入れた initrd overlay を組む |
| 9 | PXE インストール実行 | **7735HS** | **オーナーの手** | 3 の install image + 8 + 消去/縮小の決定（下 §3 の候補順序）。tty 前でフル SHA-256 を入力できる状態 | firmware のネットブート選択 → `init-install.sh` がガード（NIC MAC 0c:47:a9:60:9d:34、1 namespace 500118192 sectors、root/LUKS UUID、他 local disk 拒否）を通過 → SHA-256 一致 → 二度目の読込で一致 → **フル SHA-256 を完全に入力して確認** → `dd` write → readback hash が一致したら `AWAI_INSTALL_COMPLETE` でシェルに留める |
| 10 | インストール後の起動 | **7735HS** | オーナー（firmware 起動スキャン） | 9 で readback が一致 | reboot → firmware の boot entry でインストール済み disk から GRUB 起動 → 実測（sys.boot_completed 等）を新規日付の `docs/evidence/` に記録（既存は書き換えない） |
| 11 | RAM Live 再確認（audit プロファイル、NVMe 書込なし） | **10.77.0.1 を持つホスト** | bot（電源・UEFI は owner） | 10.77 LAN 復旧。pinned 候補の digest 記録（`artifacts-20261116.json`）。§4 手順 | §4 のコマンド。`audit` プロファイル = NVMe を read-only で眺めるだけのモード |

注意: 「persistent」はディスクに書いた場合だけ書く。RAM Live は RAM Live と書く。
§3 の (b) は「p3 の尾 28.65 GiB のデータを失う縮小」の意味であり、**データ保持の縮小ではない**。
LUKS コンテナの末尾を切る = その領域のデータは失われる（縮小が成立するのは、fs が縮小可能で LUKS を縮小・再暗号化できる場合だけ）。

## 3. インストーラ run plan 2分岐（apply しない）

候補順序（決定はオーナー）：1. **(c) 2本目ディスク** — 既存 NVMe 無傷で最安全（推奨の代替は後述）。
2. **(a) nvme0n1 全消去** — 最短。既存データ全喪失。3. **(b) p3 末尾 truncate** — データ喪失を承知の上での最後の手段。

> **2026-11-24 オーナー決定: (c) 2本目ディスク。(a)(b1) は承認されず実行対象外**（既存データを破壊するため）。
> (a)(b1) は履歴として残す。**(c) 必須仕様: 512e（論理セクタ 512）・64 GiB 以上。** `sgdisk -p <disk>` で論理セクタが 512 であることを確認してから `awai-pc-install.py plan`。4Kn は installer が拒否するため、そこで止まる。

記録 GPT（[`evidence/physical-gpt-audit-20261121.json`](../../android/desktop/persistence/evidence/physical-gpt-audit-20261121.json)）:
`nvme0n1` 500118192 sectors、512-byte。p1 otehon-esp 2048–2099199、p2 otehon-root 2099200–52430847（24.0 GiB）、p3 otehon-state 52430848–500118158（447687311 sectors = 213.5 GiB）。free は 34–2047 のみ（aligned 空間 0）。`minimumContiguousSectors` = **60082176**（userdata 16 GiB + 残りの aligned 合計）。

### (a) nvme0n1 全消去して新規 A/B（第二候補）

- **free range**: 2048–500118158 = 500116111 sectors（60082176 ≥ 必要を満たす）
- **失われるもの**: p1（ESP）、p2（nvme0n1p2 ext4：`/awai-android-2992` の userdata/metadata/cache images を含む）、p3 の LUKS 暗号全体（~213 GiB）。実行前に p2 の contents と p3 のオフライン暗号化保存が必須
- **実行ホスト**: p3 の暗号化保存後に、オーナーが決めてから PXE install profile（§2 #7, #8）。この Mac からは apply は実行しない
- **`awai-pc-install.py plan` の想定出力**: この分岐は空の disk に新しい 11 分区を作る（`freeRangeUsed: [2048, 500118158]`、first は `awai_esp 2048–264191`、last は `userdata …–60084223` ）。想定は KVM 2026-11-19 record がちょうど `minimumContiguousSectors=60082176` に一致するので、サイズの並びはその record と同等。cd22c762 の per-partition 内訳は stock disk が来れば確定。それ以外は上記総量で成立

### (b) p3（52430848–500118158 = 213.5 GiB）末尾 truncate — 28.65 GiB のデータ喪失を承知の上での最後の手段

- **方法**: p3 の**尾**を切る（LUKS ヘッダのある先頭は触らない）。`sgdisk` で新 p3 end = **440035327** とし、新 free range = [440035328, 500118158] = 60082831 sectors。p1/p2 は無変更、幅は 60082176 を満たす
- **失われるもの**: **LUKS ボリュームの末尾 28.65 GiB のデータは失われる**（LUKS ヘッダと p1/p2 は残るが、それはデータ保持ではない）。LUKS + fs の shrink 後でないとその領域は破壊される。owner のオフライン作業が必須
- **実行ホスト**: オフライン縮小はこの Mac ではなく、この Mac の Mac 以外（NVMe の縮小は 7735HS 上の Linux または PXE RAM Live の別の運用）で、オーナーが実施・押さえる。**本番 NVMe への適用は sgdisk がこの Mac に無いため禁止**（§1）
- **plan の想定出力**: 既存 p2 保持時に `existingUnchanged: true` の条件で新しい 11 分区が置ける（`new[0].start = 440035328`）。`awai-pc-install.py plan` をオフライン縮小後・install image 同伴で実行し、track record を作る。確認してから install に進める。**apply は本 plan で実行しない**

### 推奨の代替 (c) 2本目ディスク — 既存 NVMe を触らない第一候補（**2026-11-24 オーナー決定**）

上記 2 分岐は既存 NVMe の上での計画だが、推奨は新しい第 2 のディスクを使う方法であり、2 分岐のどれも実行しない。512e disk（≥ 64 GiB）・`sgdisk -p` で 512-byte logical 確認 — 4Kn は installer が拒否するのでそこで止まる。既存 NVMe を読込にもしない。plan は (a) と同じ行（`freeRangeUsed` 先頭 2048、最小 disk sectors 60084257）、実行は §2 #6 の NVMe を付けた Linux ホスト（本物は 2 本目 disk の sgdisk 検証）。

### 3分岐の共通注記

- `sgdisk` が無いこの Mac では **plan は実行できない**（`FileNotFoundError: 'sgdisk'`）。実際に走るのは別環境（sgdisk 入りの Linux ホスト §2）で、その結果はまだ得ていない。したがって本稿の plan 出力は想定であり、実測とは呼ばない（分岐の数値は記録 GPT から算出）
- R2 非依存: PXE の install image 配信はこの Mac の 10.77.0.1:18091（直結 LAN）で、R2 は介さない。OTA の publish 側は `deploy/ota-feed/`（参照のみ）
- apply は**絶対に実行しない**（§2 #5 オーナー手番の PXE 起動後に限る）

## 4. LAN 復旧時の RAM Live 再確認手順（persistent とは別もの）

前提（owner の手）: 10.77 直接ケーブルの復旧と 7735HS の電源 + UEFI ネットワークブート選択。
本章の制御側は **10.77.0.1 を持つホスト**（この Mac または同等ホスト）から叩く。
**audit プロファイル = NVMe を read-only で眺めるだけのモード。NVMe への書込は一切しない。**
**「persistent」「永続」と書けるのはディスクに書いた場合だけ**であり、本章は **RAM Live** と呼ぶ。

手順（10.77.0.1 側のホスト用具体コマンド）:

1. `ping -c2 10.77.0.2` → 通ること。`ifconfig` で自ホストに 10.77.0.1 があること。
2. artifacts（serve 用の manifest pin は `android/desktop/netboot/artifacts-20261116.json` の served 行列）:
   - pinned 候補 parts: `lineage-24.0_aa` / `lineage-24.0_ab`、digests は `android/desktop/pc-evaluation-pins.json` の値（aa `sha256:b42ebd16f855cb1314194bb065557a738443ce8920955ae1d3aa146aa93cc901`、ab `sha256:7013b32d12390e7f985b5d66018644cfff9057ce3405257f8bad83dbc6464ff0`）。
   - これらと kernel/initrd を同一 artifact dir に入れて manifest の `files`（bytes + sha256）を組む。
3. iPXE の audit プロファイルを作る（**NVMe 書込なし**の確認専用。persistent プロファイルではない）:

   ```
   node android/desktop/persistence/patch-ipxe.mjs <pinned ipxe.efi sha256 e7fb0e08...> audit <out.efi>
   ```
4. serve + ログ集約（10.77.0.1 側）:

   ```
   node android/desktop/persistence/serve-artifacts.mjs <dir> <manifest.json> &
   node android/desktop/persistence/collect-boot-log.mjs <log>
   ```
   firmware route を `switch-route.mjs` で artifact dir へ切替（**persistent 経路ではない。audit 用 dir を指定**）。終わったら元の route へ戻す。
5. 7735HS 側で firmware のネットブートを選択（owner）。起動し、boot status ページ `http://10.77.0.2:18092/` で stage を監視。
6. adb readback（10.77.0.1 本人から）:

   ```
   adb -s 10.77.0.2:5555 shell getprop sys.boot_completed      # 期待値: 1
   adb -s 10.77.0.2:5555 shell getprop ro.build.version.sdk    # 期待値: 37
   adb -s 10.77.0.2:5555 shell ls /sys/block                   # 期待値: nvme0n1 は「出ない」（netboot init.sh が local disk 可視を拒否する設計）
   adb -s 10.77.0.2:5555 shell df /data                          # 期待値: tmpfs。永続化ではない
   ```
7. evidence 記録: 新規日付の **本節専用の JSON** を以下に記録する（既存証拠は書き換えない）:

   ```
   android/desktop/persistence/evidence/ram-live-reaudit-<date>.json
   ```
   含めること: 4 値（bootcompleted / SDK / block list / df）のコマンド + 生出力。**「RAM Live」と明記し、「persistent」「永続」とは書かない**。

RAM Live の実測結果が終わるまで、disk persistence の議論を先行させてはならない。
