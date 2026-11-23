# 7735HS 永続インストール + OTA: 実測と runbook

更新: 2026-11-23 23:58 JST（以降の追記は末尾に日付で）。追跡: item 166 / AWAI-3585・AWAI-3586。

この文書は **準備物だけ**です。ビルド、署名、鍵生成、`apply`、feed 公開は実行していません。
12:00 JST の成果物は (d)（実測・コマンド確定・install 2分岐・RAM Live 再確認手順）。

対象機: 7735HS（Ryzen 7 7735HS / Radeon 680M、旧称 6600H は target label）。
直結 LAN は `10.77.0.1/24`（サーバ）⇔ `10.77.0.2`（Desktop）。

## 1. 実測ステータス（2026-11-23 23:58 JST、mbp21 上）

| 項目 | 実測 | 意味 |
| --- | --- | --- |
| Vultr 認証情報 | keychain item `vultr-awai-build` **なし（exit 44）** | VKE の `status` すら叩けない |
| VKE kubeconfig | `~/.kube` **なし** | `vke-release-pool.mjs` の前提が無い |
| 署名済み target-files / disk image / OTA zip | 200MB 超は 8 件、**すべて APK / gguf / `.a` / `.git pack`**（target-files・image・OTA **0 件**） | 素材がこの Mac に無い |
| AOSP ツリー | `envsetup.sh` **0 件** | ローカルビルド不可 |
| この Mac の能力 | **11 GiB 空き / 10 core / 16 GiB RAM** | 要求（16 vCPU・64 GiB・500GB+）に遠い |
| OTA/リリース鍵 | `*.pk8` / `*releasekey*` **0 件** | 鍵が無い（`store/keys/` は catalog 用で OTA ではない） |
| `sgdisk` | `which sgdisk` **空** | `awai-pc-install.py plan` が実行できない |
| 直結 LAN | IPv4 は `10.10.10.1 / 192.168.2.1 / 192.168.1.20 / tailscale` のみ、**`10.77.0.0/24` なし**、`ping 10.77.0.2` **3発 0 受信** | この Mac はインストール経路のネットワーク脚に居ない |
| `ota.awai.network` | `/` `404`、`/v1/pc/pilot/index.json` `404`、`/v1/pc/pilot/feed.json` `404` | feed 未配信（実装は Organizer の worker の担当） |

生の出力（2026-11-23 23:58 JST）:

```
$ security find-generic-password -s vultr-awai-build -a awai; echo exit=$?
security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.
exit=44
$ ls ~/.kube
ls: /Users/node/.kube: No such file or directory
$ find ~/orca ~/Downloads ~/Desktop ~/github ~/.orca -type f -size +200M | wc -l
       8
$ find ~ -maxdepth 3 -name envsetup.sh -not -path "*/Library/*" | wc -l
       0
$ df -h /System/Volumes/Data
Filesystem      Size    Used   Avail Capacity iused ifree %iused  Mounted on
/dev/disk3s5   228Gi   177Gi    11Gi    95%    4.4M  117M    4%   /System/Volumes/Data
$ sysctl -n hw.ncpu hw.memsize
10
17179869184
$ find ~ -maxdepth 4 \( -name "*.pk8" -o -name "*releasekey*" \) | wc -l
       0
$ which sgdisk
$ ifconfig | grep "inet " | grep -v 127.0.0.1
	inet 10.10.10.1 netmask 0xffffff00 broadcast 10.10.10.255
	inet 192.168.2.1 netmask 0xffffff00 broadcast 192.168.2.255
	inet 100.117.208.83 --> 100.117.208.83 netmask 0xffffffff
	inet 192.168.1.20 netmask 0xffffff00 broadcast 192.168.1.255
$ ping -c 3 10.77.0.2
--- 10.77.0.2 ping statistics ---
3 packets transmitted, 0 packets received, 100.0% packet loss
$ curl -s -o /dev/null -w '%{http_code} https://ota.awai.network/'
404 https://ota.awai.network/
$ curl -s -o /dev/null -w '%{http_code} https://ota.awai.network/v1/pc/pilot/index.json'
404 https://ota.awai.network/v1/pc/pilot/index.json
$ curl -s -o /dev/null -w '%{http_code} https://ota.awai.network/v1/pc/pilot/feed.json'
404 https://ota.awai.network/v1/pc/pilot/feed.json
```

記録側の唯一の署名済みビルドは VKE 実行（[pc-release-build-vke.md](pc-release-build-vke.md):
13:23–17:34 JST、5 billed hours、USD 4.77、archive 5,669,737,286 bytes、17:25 restore 検証）。
この Mac には実体が無く、**ホストの現在の生死は不明**（認証情報が無く確認できない）。

## 2. コマンド確定表（ホスト別・誰の手か）

ホスト略号:
- **A** Linux ビルドホスト（VKE pool または短命 VM、AOSP ツリーと 500GB+ 空き）
- **B** 署名を行うオーナー Mac（リリース鍵と AOSP releasetools が同居する環境）
- **C** NVMe を付けた Linux ホスト（**`sgdisk` がある**・NVMe を直接見る）
- **D** `10.77.0.1/24` を持つホスト（DHCP/TFTP/HTTP/NBD サーバ）
- **E** この Mac（mbp21、検証と記録のみ）

| # | ステップ | ホスト | 誰 | コマンド / 前提 | 残す証跡 |
| --- | --- | --- | --- | --- | --- |
| 1 | A/B パッチ適用 | A | bot | `android/desktop/pc-ab-device/apply.sh <source tree root>`。`user` を出すなら続けて `apply-shipping-debug-lockdown.sh <source tree root>`（`.agent-output` 参照の判断は別途） | `git -C <project> diff --check`、`--check` の出力 |
| 2 | Updater feed URL を焼き込む | A | bot | `python3 android/desktop/pc-ab-device/updater-feed.py configure-release "$ANDROID_BUILD_TOP/packages/apps/Updater" "$AWAI_OTA_FEED"`。`AWAI_OTA_FEED` の URL は §6 の担当が決める | Updater の `diff --check` |
| 3 | A/B target-files ビルド | A（有償 VKE） | **オーナー承認 → bot が実行** | `node scripts/operator/vke-release-pool.mjs status "$KUBECONFIG"` で空き確認、`run "$KUBECONFIG" -- "$RELEASE_WORKFLOW"`。計画 `vc2-16c-64gb`、実測 **4h11m**（13:23–17:34）・**5 billed hours / USD 4.77** | ビルド digest 5 本、archive 5,669,737,286 bytes、pool 解放の記録 |
| 4 | target-files の構成正否 | E または A | bot | `python3 android/desktop/pc-ab-device/updater-feed.py verify-target-files "$SIGNED_TARGET_FILES" "$AWAI_OTA_FEED" --sha256 "$SIGNED_TARGET_FILES_SHA256" --device virtio_x86_64`（`aapt2` が PATH に要る） | 検証レコード、SHA-256 |
| 5 | 署名（AVB/OTA 署名鍵） | B | **オーナー** | 鍵は生成しない・移動しない。既存鍵で target-files を再署名し、`verify-selinux-policy.py` で SELinux ポリシー差し替えを確認。`OTA_KEY_BASENAME`・公開証明書・`OTA_CERTIFICATE_SHA256` は**署名記録側に記録**（値はリポジトリに置かない） | 署名記録、certificate SHA-256、`signatureVerified: true` |
| 6 | disk image 組み立て | A または C | bot | `make-tf-disk.sh TARGET_FILES STOCK_DISK OUTPUT_DISK`。`AWAI_TARGET_FILES_SHA256` / `AWAI_STOCK_DISK_SHA256` / `AWAI_ANDROID_ROOT` / `AWAI_ANDROID_HOST_OUT` を設定（`build_super_image` `lpmake` `simg2img` が `host/linux-x86/bin` に要る） | 入力 2 本の SHA-256 と出力 image の SHA-256、`simg2img` を通した raw の byte 数 |
| 7 | full OTA 生成 | B | **オーナー**（鍵が要る） | `python3 android/desktop/pc-ab-device/updater-feed.py generate-ota "$SIGNED_TARGET_FILES" "$OTA_ZIP" --key "$OTA_KEY_BASENAME" --certificate-sha256 "$OTA_CERTIFICATE_SHA256" --target-sha256 "$SIGNED_TARGET_FILES_SHA256" --require-streaming > "$OTA_VERIFICATION_RECORD"` | `$OTA_VERIFICATION_RECORD`、OTA の SHA-256 |
| 8 | OTA 検証 | E または C | bot | `updater-feed.py verify-ota "$OTA_ZIP" "$OTA_CERTIFICATE" "$SIGNED_TARGET_FILES" --certificate-sha256 … --target-sha256 … --require-streaming`（delta なら `--source-target-files` / `--source-sha256` も） | 検証レコード |
| 9 | index / feed 公開 | feed 側 | **Organizer の worker** | `updater-feed.py make-index "$OTA_ZIP" "$OTA_URL" --sha256 … --device …`。公開先と公開者は §6 | — |
| 10 | install の plan | C | bot（**apply は承認後**） | §3 | plan JSON、使う free range、失う範囲 |
| 11 | install の apply | C | **オーナー承認 → bot** | `awai-pc-install.py apply <disk> <verified image> --source-sha256 "$INSTALL_IMAGE_SHA256" --record record.json`（`record` は新規パス） | `record.json`、`existingUnchanged: true`、新 GPT の readback |
| 12 | LAN ブート | D | bot（電源とブート選択はオーナー） | §4 | boot ログ、`getprop`、screencap |

## 3. インストーラ run plan の2分岐（sector 単位）

実測 GPT（`android/desktop/persistence/evidence/physical-gpt-audit-20261121.json`、512B/sector）:

```
sectors            500118192      firstUsable 34      lastUsable 500118158
p1 otehon-esp        2048 –   2099199
p2 otehon-root    2099200 –  52430847
p3 otehon-state  52430848 – 500118158   (447,687,310 sectors = 213.47 GiB)
free                    34 –      2047   (2,014 sectors = 1.0 MiB)
```

必要量（`userdata` 16 GiB 指定時、`ALIGN=2048`）: **60,082,176 sectors = 28.65 GiB**
（userdata 16.00 GiB + system/その他 12.65 GiB）。現状の plan 結果は refusal:

```
REFUSED not-enough-free-space: need 60082176 sectors in one free range, free ranges [(34, 2047)]
```

`make_plan()` は **空き範囲から確保するだけで縮小機能を持たない**（`free_ranges` + `best` の実装）。
したがって2分岐のうち縮小は**インストーラの外**で行う作業です。

### 分岐A: 消去して入れる

1. C で既存 p1–p3 を削除（`sgdisk --delete=1/2/3 <disk>`、または wipe）。失うもの: **ESP（Nix ブート資産）・root・state 213.47 GiB すべて**。
2. `awai-pc-install.py plan <disk> <disk-vda.img>` → 空きは実質 `(34, 500118158)` になり通る。
3. `apply` で `awai_esp` `super` `misc` `persist` `metadata` `firmware` `vendor_boot_a/b` `boot_a/b` `userdata` を追加。

失うものの注意: 2026-11-16 の記録は `existingNixFilesRetained: true`、`nixGptEdgesSha256BeforeTrial: 0cc75b8c…` で、
**Nix の GPT エッジとファイルを保持したまま**の trial でした。消去はその前提を捨てます（オーナー判断）。
名前衝突は無い（installer 側の名前は `awai_esp` ほかで、`otehon-*` と重ならない）。

### 分岐B: p3 を 28.65 GiB 以上縮小して非破壊で入れる

p3 を **`52430848–440035327`（387,604,480 sectors = 184.82 GiB、現行 213.47 GiB から 28.65 GiB 縮小）** にすると、
free が **`440035328–500118158`（60,082,831 sectors = 28.65 GiB）** になり、`ALIGN=2048` の整列後も必要量を満たします。

1. C で p3 の ext4 をオフライン縮小（`resize2fs` は**先にファイルシステムを縮小**、その後 `sgdisk --delete=3 --new=3:52430848:440035327 --change-name=3:otehon-state`）。**p3 は state なので、縮小前に中身のバックアップと `e2fsck -f` が要る**。
2. GPT 変更後に **readback を取り、`physical-gpt-audit` 形式で新しい GPT を証跡化**（`gptUnchanged` の判定は trial 前後で別途）。
3. `awai-pc-install.py plan <disk> <disk-vda.img>` を通す。**apply はオーナー承認後**。

縮小で失うもの: p3 の末尾 28.65 GiB に載っていたデータ（Nix ストアの一部・ユーザーデータ）。**どのファイルが消えるかは縮小前に列挙が必要**（未実施）。

### plan を実行するホストと前提

- **C（Linux、`sgdisk` あり、NVMe 直結）**。この Mac では `plan` すら動かない（実測: `FileNotFoundError: 'sgdisk'`）。
- 前提: 512B logical sector の両方、`plan` は書込なし、`apply` は `--record` が新規パス、`--source-sha256` は小文字 64 hex。
- **`apply` はこの文書では実行しない。** 実行はオーナー承認後、C 上で。

## 4. LAN 復旧時の **RAM Live** 再確認手順（persistent と呼ばない）

これは RAM Live です。**再起動でデータは消えます**（11-16 の記録でも `persistentAndroidInstall: deferred`、
`storage.userdata: tmpfs`、`localNvmeInstallerExecuted: false`）。ディスクへの永続化は §3 の話で、まだ実行していません。

手順（ホスト **D**、`10.77.0.1/24` を持つホスト）:

1. D の直結 Ethernet に `10.77.0.1/24` を付与（`archive/nixos/docs/otehon/lan-diagnostics.md:36` の構成）。
2. 認証済み artifact を配る: `ipxe.efi` / `kernel` / `initrd` を HTTP **18090** で、NBD を **10829** で。
   11-16 の実測値（`android/desktop/netboot/artifacts-20261116.json`）:
   - `kernel` 14,307,328 bytes `921907ef5703f4b762a0c0f457ecf1734eae8384fece79ca953d13c474d56c3a`
   - `initrd` 104,489,934 bytes `1161c1ab78937faa358af0d1bfee297ea9456349cd30e6bc3c9d6ec29ed43974`
   - `ipxe.efi` 311,296 bytes `e7fb0e08d957f4e8014348f95717ececbf81513d52a5b6f275b782fed426d5eb`
   - `init.sh`（`/awai-netboot`, mode 0755）と `/awai/` のモジュール群も同じ pin で揃える
3. `qemu-nbd --read-only --persistent --shared=2 --export-name awai2992 --format=raw <iso>` を 10829 で、
   **loopback か明示した直結 interface にのみ bind**（無制限 interface に bind しない）。
4. owner: 7735HS の電源投入 → UEFI で LAN/HTTP IPv4 を明示選択（`ipxe.nix` は `10.77.0.1:18090` を埋め込み、
   `module_blacklist=nvme,nvme_core,ahci,sd_mod,usb_storage,uas` でディスクを隠す）。
5. 確認: `adb shell getprop sys.boot_completed` = `1`、`ro.build.version.sdk` = `37`、
   `screencap -d` で 1920×1200 の physical display ID、`/sys/block` に NVMe が無いこと、`/data` が tmpfs。
6. 記録: 上の値を `docs/otehon/netboot/` 形式の観測 JSON に残す（**この文書では実行していない**）。

## 5. `10.77.0.1` のホストは evidence から特定できない（**不明**）

- `android/desktop/netboot/ipxe.nix` は `http://10.77.0.1:18090/` を埋め込むだけで、サーバの機種名を書いていません。
- `archive/nixos/docs/otehon/lan-diagnostics.md:36` は「**The Mac's** direct Ethernet interface has address `10.77.0.1/24`」とだけ書いています。
- `physical-observation-20261116.json` / `artifacts-20261116.json` / `6600h-lan-qa-status-20261117.md` のいずれにも
  ホスト名・シリアル・機種の記録はありません。
- 実測: **この Mac（mbp21）は `10.77.0.0/24` を持っていません**（§1）。

→ **オーナーへの確認事項: 2026-11-16 の物理 Live を実行した「`10.77.0.1` を持つ Mac」はどれか**（jacob / mini-2xx / 別機）。
特定できるまで §4 は D を「未確定」として扱います。

## 6. OTA feed の公開先（参照のみ）

`index` の配置と publish は `ota.awai.network` の feed origin 側の担当（awai-os の `deploy/ota-feed/` worker、
R2 非依存・yataverse 経由）。この文書では**公開手順を持たず、§2 #9 から参照するだけ**にします。

## 7. この文書で実行していないこと

- 有償 VKE ビルドの開始（オーナー承認待ち）
- OTA/リリース鍵の生成・署名（オーナー手番）
- `awai-pc-install.py apply`（承認前は禁止）
- OTA feed / 公開物の変更（Organizer の worker の担当）
- `store/distribution` や既存 `docs/evidence` の書き換え

## 8. 分かっていないこと

- Vultr/VKE ホストの現在の生死と、直近ビルド成果物の所在（この Mac に認証情報が無い）
- 署名に要する実時間（この Mac に署名環境が無く計測不能）
- 28.65 GiB を実機 NVMe に書く時間（この規模の実測記録が無い。11-16 trial は ISO の byte 数すら未記録）
- p3 縮小で実際に失われるファイルの一覧（縮小前の棚卸しが未実施）
