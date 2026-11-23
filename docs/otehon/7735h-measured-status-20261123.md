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

## 2. ホスト別コマンド確定表

凡例: **オーナー** = 人の手（課金・鍵・消去・deploy は bot が持てない）。
**bot** = オーケストラから操作可能なエージェント作業ただし結果の最終確認は owner。
各行の前提が満たされて初めて次へ進める。

| # | 工程 | ホスト | 誰の手 | 前提 | コマンド |
| --- | --- | --- | --- | --- | --- |
| 1 | AOSP ビルド（signed target-files + stock disk まで） | **Linux ビルドホスト** | bot（owner が開錠） | **有料ビルドの owner 可否**（既定は free-only policy。Vultr で課金が発生するなら発注前に確認）。認証情報は Keychain に無い（exit 44）ため、owner が実体を渡す | `m target-files-package diskimage-vda otatools`（`android/desktop/target-files/evidence/target-files-20261119.json` の手順）→ 署名済み target-files ZIP + SHA-256（signing record）+ stock disk SHA-256（build record）を取り出す |
| 2 | 署名（zipsigner / release） | **署名 Mac + signing environment** | **オーナーの手**（鍵を bot が触らない） | 1 が完了。鍵 basename + cert.pem の実体が signing environment にある | 署名完了 → 署名済み ZIP の SHA-256 を signing record に記録 |
| 3 | install image 組立 | **Linux ビルドホスト** | bot | 1,2 完了。`AWAI_ANDROID_HOST_OUT` = `$OUT_DIR/host/linux-x86`（build_super_image/lpmake/simg2img 入り） | `bash android/desktop/pc-ab-device/make-tf-disk.sh $SIGNED_TARGET_FILES $STOCK_DISK $INSTALL_IMAGE`（`install-media.md`）。SHA-256 を release manifest に記録 |
| 4 | OTA generate / verify | **Linux ビルドホスト**（releasetools 同梱） | bot | 1–3 完了。`ota_from_target_files` と `check_ota_package_signature` が PATH 上。鍵 basename + `--certificate-sha256` | `python3 android/desktop/pc-ab-device/updater-feed.py generate-ota ... --require-streaming` → `verify-ota`。make-index はこの後 index publish で使う |
| 5 | index publish | **ota-feed Worker**（`deploy/ota-feed/`、R2 非依存） | bot（deploy は owner 確認） | OTA feed 参照だけ（別 worker が実装中 — 本書は参照 1 行で触らない）。data は yataverse（Worker 内 blob は ingest 済み） | `scripts/publish-index.py`（`updater-feed.py make-index` 再利用）→ index を publish → `/v1/pc/pilot/{device}/{incr}/builds.json` で 200 を実測 |
| 6 | PXE 前段（この Mac） | **この Mac**（sgdisk 未導入） | bot | 10.77 直接 LAN が復旧（`ping 10.77.0.2` が通る + この Mac に 10.77.0.1 を割る）こと。実測は §1。`sgdisk` が無い間は plan も走らない （install は不可） | `node android/desktop/persistence/serve-install.mjs <dir> <manifest.json>` on 10.77.0.1:18091（manifest が kernel/initrd/ipxe.efi/install.img の SHA-256 を pins） |
| 7 | PXE install profile 組立 | **この Mac** | bot | 前段完了。install profile は firmware route の独立した artifact dir（`switch-route.mjs` で active 先を切り替え、終わったら戻す）。`patch-ipxe.mjs install` は 5 既存 entry の code path に触れない | `node android/desktop/persistence/patch-ipxe.mjs <pinned ipxe.efi> install <out.efi> erase 500118192`。`init-install.sh` を `/init` とし、`/awai/install.pins`（template 通り）に SHA-256/bytes を入れた initrd overlay を組む |
| 8 | PXE インストール実行 | **7735HS** | **オーナーの手** | 6,7 完了 + 3 の install image + 消去/縮小の決定（下表の 2 分岐）。tty 前でフル SHA-256 を入力できる状態 | firmware のネットブート選択 → `init-install.sh` がガード（NIC MAC 0c:47:a9:60:9d:34、1 namespace 500118192 sectors、root/LUKS UUID、他 local disk 拒否）を通過 → SHA-256 一致 → 二度目の読込で一致 → **フル SHA-256 を完全に入力して確認** → `dd` write → readback hash が一致したら `AWAI_INSTALL_COMPLETE` でシェルに留める |
| 9 | インストール後の起動 | **7735HS** | オーナー（firmware 起動スキャン） | 8 で readback が一致 | reboot → firmware の boot entry でインストール済み disk から GRUB 起動 → 実測（sys.boot_completed 等）を新規日付の `docs/evidence/` に記録（既存は書き換えない） |

注意: 「persistent」はディスクに書いた場合だけ書く。RAM Live は RAM Live と書く。
§3 の (b) は「p3 を 28.65 GiB 以上オフライン縮小」の意味であり、LUKS ヘッダを壊さず尾を落とす方法（ファイルシステム縮小を含む）としてのみ成立する。

## 3. インストーラ run plan 2分岐（apply しない）

記録 GPT（[`evidence/physical-gpt-audit-20261121.json`](../../android/desktop/persistence/evidence/physical-gpt-audit-20261121.json)）:
`nvme0n1` 500118192 sectors、512-byte。p1 otehon-esp 2048–2099199、p2 otehon-root 2099200–52430847（24.0 GiB）、p3 otehon-state 52430848–500118158（447687311 sectors = 213.5 GiB）。free は 34–2047 のみ（aligned 空間 0）。`minimumContiguousSectors` = **60082176**（userdata 16 GiB + 残りの aligned 合計）。

### (a) nvme0n1 全消去して新規 A/B

- **free range**: 2048–500118158 = 500116111 sectors（60082176 ≥ 必要を満たす）
- **失われるもの**: p1（ESP）、p2（nvme0n1p2 ext4：`/awai-android-2992` の userdata/metadata/cache images を含む）、p3 の LUKS 暗号全体（~213 GiB）。実行前に p2 の contents と p3 のオフライン暗号化保存が必須
- **実行ホスト**: p3 の暗号化保存後に、オーナーが決めてから PXE install profile（§2 #7, #8）。この Mac からは apply は実行しない
- **`awai-pc-install.py plan` の想定出力**: この分岐は空の disk に新しい 11 分区を作る（`freeRangeUsed: [2048, 500118158]`、first は `awai_esp 2048–264191`、last は `userdata …–60084223` ）。想定は KVM 2026-11-19 record がちょうど `minimumContiguousSectors=60082176` に一致するので、サイズの並びはその record と同等。cd22c762 の per-partition 内訳は stock disk が来れば確定。それ以外は上記総量で成立

### (b) p3（52430848–500118158 = 213.5 GiB）を 28.65 GiB 以上オフライン縮小

- **方法**: p3 の**尾**を切る（LUKS ヘッダのある先頭は触らない）。`sgdisk` で新 p3 end = **440035327** とし、新 free range = [440035328, 500118158] = 60082831 sectors。p1/p2 は無変更、幅は 60082176 を満たす
- **失われるもの**: p3 の尾 28.65 GiB（LUKS ボリューム + ファイルシステムの shrink 後でないと破壊。owner のオフライン作業が必須）。LUKS ヘッダと p1/p2、`p2` 上の persistence images は残る（ただし p2 は変わらず使える）
- **実行ホスト**: オフライン縮小はこの Mac ではなく、この Mac の Mac 以外（NVMe のデバイス的な縮小は 7735HS 上の Linux または PXE RAM Live の copy 可能な運用）で、オーナーが実施・押さえる。**本番 NVMe への適用は sgdisk がこの Mac に無いため禁止**（§1）
- **plan の想定出力**: 既存 p2 保持時に `existingUnchanged: true` の条件で新しい 11 分区が置ける（`new[0].start = 440035328`）。`awai-pc-install.py plan` をオフライン縮小後・install image 同伴で実行し、track record を作る。確認してから install に進める。**apply は本 plan で実行しない**

### 両分岐の共通注記

- `sgdisk` が無いこの Mac では **plan は実行できない**（`FileNotFoundError: 'sgdisk'`）。実際に走るのは別環境（sgdisk 入りの Linux ホスト §2）で、その結果はまだ得ていない。したがって本稿の plan 出力は想定であり、実測とは呼ばない（分岐の数値は記録 GPT から算出）
- R2 非依存: PXE の install image 配信はこの Mac の 10.77.0.1:18091（直結 LAN）で、R2 は介さない。OTA の publish 側は `deploy/ota-feed/`（参照のみ）
- apply は**絶対に実行しない**（§2 #5 オーナー手番の PXE 起動後に限る）

## 4. LAN 復旧時の RAM Live 再確認手順（persistent とは別もの）

前提: オーナーが 10.77 直接ケーブルの復旧と 7735HS の電源・netboot 選択を行う（§2 #6）。
この手順は **RAM Live**（まだディスクに書く手順ではない）を実機で再実測するためのもの。
*disk に書く persistence の手順は別に存在しないが、書ければ RAM Live ではない。*

1. `ping 10.77.0.2` が通り、この Mac に 10.77.0.1 が割り当てられたことを確認（§2 #6）
2. pinned の PC Live 候補（`android/desktop/pc-evaluation-pins.json` / `artifacts-20261116.json`）から kernel/initrd を用意。sha を記録し、manifest の `files`（bytes + sha256）に pins
3. ホスト側 `collect-boot-log.mjs` を起動。`patch-ipxe.mjs <ipxe.efi> persistent <out.efi>` で 5 既存 entry に触れず、新 artifact dir を firmware route の active 先にする
4. netboot init（tmpfs /data、RAM copy）は前回実測の挙動通り。表示・入力・アプリ確認は 2026-11-16 の実測と同等までを RAM Live の実測として記録
5. RAM Live である旨明記（「persistent」と呼ばない）。`/data` は tmpfs のため reboot で消失する旨の通知が表示されること
6. 実測を**新規日付**の証拠ファイルにし、既存の証拠は書き換えない。`docs/evidence/persistent.md` 等の update があれば同様に date 付きで

RAM Live の実測結果が終わるまで、disk persistence の議論を先行させてはならない。
