# 7735HS 永続インストール + OTA: 運用 runbook

更新: 2026-11-23。追跡: item 166 / AWAI-3585・AWAI-3586。

**この文書は手順を持つ。** 実測記録とディスク計画の根拠（数値・sector・候補順序）は
[7735h-measured-status-20261123.md](7735h-measured-status-20261123.md)（PR #479）が正で、ここでは再掲しない。

この文書の作業で実行していないこと: ビルド、署名、鍵生成、`apply`、feed 公開（§8）。

対象機: 7735HS（Ryzen 7 7735HS / Radeon 680M。旧称 6600H は target label）。
直結 LAN は `10.77.0.1/24`（サーバ）⇔ `10.77.0.2`（Desktop）。

## 1. 手順の前提（実測の正は #479）

この runbook は次の前提が満たされた時だけ進む。値と生出力は #479 §1。

- Linux ビルドホストの認証情報が**この Mac に無い** → ビルドは起動できない状態から始まる
- 署名済み target-files / disk image / OTA zip が**この Mac に無い**
- AOSP ソースツリーが**この Mac に無い**
- OTA/リリース鍵が**この Mac に無い**
  （`store/keys/dev-catalog-signer.pem` は catalog 用の**証明書のみ**で、OTA 鍵ではない）
- この Mac に **`10.77.0.0/24` が無い**（`10.77.0.2` も応答しない）
- この Mac に **`sgdisk` が無い**（installer の `plan` すら走らない）

## 2. コマンド確定表（ホスト別・誰の手か）

ホスト略号:
- **A** Linux ビルドホスト（VKE pool または短命 VM。AOSP ツリーと十分な空き）
- **B** 署名を行うオーナー Mac（リリース鍵と AOSP releasetools が同居する環境）
- **C** NVMe を付けた Linux ホスト（`sgdisk` あり・NVMe を直接見る）
- **D** `10.77.0.1/24` を持つホスト（DHCP/TFTP/HTTP/NBD サーバ。§7 で未確定）
- **E** この Mac（mbp21、検証と記録のみ）

| # | ステップ | ホスト | 誰 | コマンド / 前提 | 失敗時の見え方 |
| --- | --- | --- | --- | --- | --- |
| 1 | A/B パッチ適用 | A | bot | `android/desktop/pc-ab-device/apply.sh <source tree root>`。`user` を出すなら続けて `apply-shipping-debug-lockdown.sh <source tree root>` | パッチが当たらず exit 1（`pending` のまま）。一部だけ当たる状態にはならない |
| 2 | Updater feed URL を焼き込む | A | bot | `python3 android/desktop/pc-ab-device/updater-feed.py configure-release "$ANDROID_BUILD_TOP/packages/apps/Updater" "$AWAI_OTA_FEED"`。URL の決定は §6 | Updater 側 `diff --check` に差分が残る＝未適用 |
| 3 | A/B target-files ビルド | A（有償 VKE） | **オーナー承認 → bot 実行** | `node scripts/operator/vke-release-pool.mjs status "$KUBECONFIG"` → `run "$KUBECONFIG" -- "$RELEASE_WORKFLOW"`。所要と費用は #479 と [pc-release-build-vke.md](pc-release-build-vke.md) | `status` 失敗＝kubeconfig 不在。`run` 後の失敗は `abort` で pool 解放。`RELEASE FAILED … may still be billing` が出たら即 `abort` を再実行 |
| 4 | target-files の構成正否 | E または A | bot | `updater-feed.py verify-target-files "$SIGNED_TARGET_FILES" "$AWAI_OTA_FEED" --sha256 "$SIGNED_TARGET_FILES_SHA256" --device virtio_x86_64`（`aapt2` が PATH） | APK リソース／A/B 分区／build prop の不一致で exit 1。`aapt2` 不在は別メッセージ |
| 5 | 署名（AVB/OTA） | B | **オーナー** | 鍵は生成も移動もしない。再署名後に `verify-selinux-policy.py` でポリシー差し替えを確認。`OTA_KEY_BASENAME`・公開証明書・`OTA_CERTIFICATE_SHA256` は**署名記録側**に記録（値はリポジトリに置かない） | 署名検証が `false`／SELinux ポリシー差し替え不一致で停止 |
| 6 | disk image 組み立て | A または C | bot | `make-tf-disk.sh TARGET_FILES STOCK_DISK OUTPUT_DISK`。`AWAI_TARGET_FILES_SHA256` / `AWAI_STOCK_DISK_SHA256` / `AWAI_ANDROID_ROOT` / `AWAI_ANDROID_HOST_OUT` | `Missing Android host tool` ＝ `build_super_image`/`lpmake`/`simg2img` が `host/linux-x86/bin` に無い。`SHA-256 differs` ＝ 入力が記録と違う |
| 7 | full OTA 生成 | B | **オーナー**（鍵が要る） | `updater-feed.py generate-ota "$SIGNED_TARGET_FILES" "$OTA_ZIP" --key "$OTA_KEY_BASENAME" --certificate-sha256 "$OTA_CERTIFICATE_SHA256" --target-sha256 "$SIGNED_TARGET_FILES_SHA256" --require-streaming > "$OTA_VERIFICATION_RECORD"` | 署名検証が通るまで出力を作らない＝**出力が無いのが正常な失敗形** |
| 8 | OTA 検証 | E または C | bot | `updater-feed.py verify-ota "$OTA_ZIP" "$OTA_CERTIFICATE" "$SIGNED_TARGET_FILES" --certificate-sha256 … --target-sha256 … --require-streaming`（delta は `--source-target-files` / `--source-sha256`） | ZIP 署名と A/B payload 署名のどちらで落ちたかがメッセージに出る。fingerprint／増分版の不一致もここで止まる |
| 9 | index / feed 公開 | feed 側 | **Organizer の worker** | §6 の担当。この文書は手順を持たない | — |
| 10 | install の plan | C | bot（`apply` は承認後） | §3 | `REFUSED not-enough-free-space` / `REFUSED name-in-use` / `REFUSED overlap` / `REFUSED source-has-no-partition` |
| 11 | install の apply | C | **オーナー承認 → bot** | `awai-pc-install.py apply <disk> <verified image> --source-sha256 "$INSTALL_IMAGE_SHA256" --record record.json`（`--record` は新規パス） | 既存分区の前後 digest 不一致、新 GPT の readback 不一致、`--source-sha256` 形式エラーで停止。成功時のみ record に `existingUnchanged: true` |
| 12 | LAN ブート（RAM Live） | D | bot（電源とブート選択はオーナー） | §4 | `sys.boot_completed` が 1 にならない／NVMe が見える／`/data` が tmpfs でない＝§4 の前提が崩れている |

「persistent」はディスクに書いた場合だけ使う。RAM Live は RAM Live と書く。

## 3. インストーラ run plan（2分岐）

分岐は **消去** と **p3 の末尾を切る縮小**。sector・候補順序・何が失われるかの根拠は
[#479 §3](7735h-measured-status-20261123.md) が正。ここは**実行手順と前提だけ**。

- **plan を実行するホスト**: **C**（Linux、`sgdisk` あり、NVMe 直結）。この Mac（E）では `plan` すら動かない。
- **前提**: 両方 512-byte logical sector、`plan` は書込なし、`apply` は `--record` が新規パス、
  `--source-sha256` は小文字 64 hex。必要量は plan 出力の `new` と `freeRangeUsed` で読み戻す。
- **縮小分岐の訂正**: `otehon-state`（p3）は **LUKS コンテナ**である
  （[archive/nixos/otehon/base-module.nix](../../archive/nixos/otehon/base-module.nix) の `cryptsetup isLuks`、
  [install-check-qemu.py:254](../../archive/nixos/otehon/install-check-qemu.py) の `state partition is LUKS`、
  [init-persistent.sh](../../android/desktop/persistence/init-persistent.sh) の `encrypted-state-uuid`）。
  したがって「`resize2fs` で縮小」はそのままでは通らない。成立するのは LUKS とその中の fs の両方を
  縮小・再暗号化できる場合だけで、**末尾を切る形では末尾のデータは失われる**。データ保持の縮小ではない。
- **`apply` はこの runbook では実行しない。** C 上でオーナー承認後にのみ。
- 2本目のディスクを使う案は #479 §3 の候補順序が持っている（決定はオーナー）。

## 4. LAN 復旧時の **RAM Live** 再確認手順

これは RAM Live。**再起動でデータは消える**（2026-11-16 の観測でも `persistentAndroidInstall: deferred`、
`storage.userdata: tmpfs`、`localNvmeInstallerExecuted: false`）。ディスク永続化は §3 の話で、未実行。

手順（ホスト **D**）:

1. D の直結 Ethernet に `10.77.0.1/24` を付与（構成は
   [lan-diagnostics.md](../../archive/nixos/docs/otehon/lan-diagnostics.md)）。
2. 認証済み artifact を配る: `ipxe.efi` / `kernel` / `initrd` を HTTP **18090**、NBD を **10829**。
   2026-11-16 の pin（[artifacts-20261116.json](../../android/desktop/netboot/artifacts-20261116.json)）:
   - `kernel` 14,307,328 bytes `921907ef5703f4b762a0c0f457ecf1734eae8384fece79ca953d13c474d56c3a`
   - `initrd` 104,489,934 bytes `1161c1ab78937faa358af0d1bfee297ea9456349cd30e6bc3c9d6ec29ed43974`
   - `ipxe.efi` 311,296 bytes `e7fb0e08d957f4e8014348f95717ececbf81513d52a5b6f275b782fed426d5eb`
   - `init.sh`（`/awai-netboot`, mode 0755）と `/awai/` のモジュール群も同じ pin で揃える
3. `qemu-nbd --read-only --persistent --shared=2 --export-name awai2992 --format=raw <iso>` を 10829 で、
   **loopback か明示した直結 interface にのみ bind**（無制限 interface に bind しない）。
4. オーナー: 7735HS の電源投入 → UEFI で LAN/HTTP IPv4 を明示選択
   （[ipxe.nix](../../android/desktop/netboot/ipxe.nix) は `10.77.0.1:18090` を埋め込み、
   `module_blacklist=nvme,nvme_core,ahci,sd_mod,usb_storage,uas` でディスクを隠す）。
5. 確認: `adb shell getprop sys.boot_completed` = `1`、`ro.build.version.sdk` = `37`、
   `screencap -d` で 1920×1200 の physical display ID、`/sys/block` に NVMe が無いこと、`/data` が tmpfs。
6. 記録: 上の値を `android/desktop/netboot/` 形式の観測 JSON で**新しい日付のファイル**に残す
   （この文書では実行していない。既存 evidence は書き換えない）。

## 5. 配信経路（3つに分かれている）

- **payload（APK・image・OTA の実体）** = **commit-pin の `raw.githubusercontent.com`**。
  リポジトリ内の commit-pin URL（`store/site/build.mjs` の host/commit 規則と同じ考え方）で参照する。
- **index / feed（JSON）** = **`ota.awai.network` の Worker**。
- **yataverse** は **16 MiB 以下のブロックのみ**。32 MiB 級は 413、CAR は gateway が返さない。

したがって「大きな OTA / disk image を yataverse の raw で配る」前提は書きません。
feed の index 配置と publish は §6 の担当。

## 6. OTA feed の公開先（参照のみ）

`index` の配置と publish、Updater の allowlist は **`deploy/ota-feed/` 側の担当（Organizer の worker）**。
この文書は手順を持たず、§2 #9 から参照するだけ。

## 7. dapps をオンライン更新できる状態にする（5段）

前提として、イメージに入っている Store がルート同梱ビルド（`assets/store-root.der`、`keys.txt`、`keys.sig`）であることを確認する。同梱されていないビルドは現行の pointer を `pointer-signature` で拒否する。以下は main の `0dc2ae2f` にある `android/shared/src/network/awai/platform/` の実装に基づく。

1. Store のインストール権限を設定する。

   ```sh
   adb shell appops set network.awai.store REQUEST_INSTALL_PACKAGES allow
   ```

2. dapp を **Store の画面から**インストールする。Store は自らのインストールが成功したときに `installed-ops-<id>` を記録する。`adb install -i network.awai.store` で設定できるのは installer of record だけで、`INTERNET` 権限を持つアプリはこの記録が無いと `operations-unknown` になる（`AutoInstall.java:171–175`）。
3. Store の「更新」タブで自動更新を有効にし、「Wi-Fi のみ」または「全回線」を選び、ネイティブダイアログで「許可」（Allow）を押す。Store は `UpdateApprovalRecord.grant()` で有効期間 90 日の承認を作成し、`v1|1|grantedAt|expiresAt|unmeteredOnly|excluded` 形式で保存する。**prefs は手で書かない。** 書き手は Store のみで、`run-as` は debuggable ビルドでしか使えず、手書きすると同意の証跡を飛ばす。
4. 端末の時計を確認する。`issuedAt` が端末時刻より 300 秒を超えて未来なら `pointer-issued`、`expiresAt` が端末時刻以前なら `pointer-expired` で拒否される。
5. 更新を手動で 1 回確認し、`adb logcat -d -s AwaiStore AwaiAutoInstall` と Store の更新ログを確認する。アプリ単位のポリシー拒否は Store の更新ログで確認する（`not-installed-by-store`、`operations-unknown`、`new-permission`、`not-newer`、`network-metered`）。

既知の落とし穴

- itonami app、animeka、dougaka、gameka、mangaka、ongakuka の 6 本は catalog に `operations` 宣言が無く、item 134 で修正されるまで自動更新の対象外。
- 17 本中 15 本が `<pkg>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` を要求する。この権限を含まない世代の APK がイメージに入っている場合、該当 15 本はすべて `new-permission` で止まる。
- `signer-changed` は実機で判定する。`adb shell pm path <pkg>` でインストール済み APK のパスを確認し、`adb pull <APK のパス>` で取得する。`apksigner verify --print-certs <取得した APK>` が出力する署名証明書の SHA-256 を catalog の 4 証明書と突き合わせ、更新先 APK の証明書との一致を確認する。

## 8. `10.77.0.1` のホスト — **未確定・オーナー確認中**

evidence に機種名・ホスト名の記録が無い（[ipxe.nix](../../android/desktop/netboot/ipxe.nix) はアドレスを埋め込むだけ、
[lan-diagnostics.md](../../archive/nixos/docs/otehon/lan-diagnostics.md) は "The Mac's direct Ethernet interface" とだけ記載、
2026-11-16 の観測 JSON と 11-17 の QA 記録にも記載なし）。この Mac に `10.77.0.0/24` が無いことは実測済み（#479 §1）。
**どの Mac か（jacob / mini-2xx / 別機）は item 166 でオーナー確認中**。確定まで §4 の D は未確定として扱う。

## 9. この文書で実行していないこと

- 有償 VKE ビルドの開始（オーナー承認待ち）
- OTA/リリース鍵の生成・署名（オーナー手番）
- `awai-pc-install.py apply`（承認前は禁止）
- OTA feed / 公開物 / Updater allowlist の変更（`deploy/ota-feed/` の担当）
- `store/distribution` や既存 `docs/evidence` の書き換え

## 10. 分かっていないこと

- Vultr/VKE ホストの現在の生死と、直近ビルド成果物の所在（この Mac に認証情報が無い）
- 署名に要する実時間（この Mac に署名環境が無く計測不能）
- 実機 NVMe への書込時間（この規模の実測記録が無い）
- p3 の LUKS 縮小が成立するか（LUKS と fs の縮小可否の確認が未実施）
