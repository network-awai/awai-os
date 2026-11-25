# AWAI-4118: Awai OS における USB mass storage の静的調査 — 2026-11-25

Tracking: AWAI-4118。対象 repo: `network-awai/awai-os`、基点
`e75afb7b186761cb7057b215551d3b335e58a458`（`origin/main`）。

設計の前提は `network-awai/network-awai-apex` の
`docs/awai-disk-format.md`（PR #381、merged、head
`647d36cf3cb139f5acb98fe7b8fc77179cf77df9`）§21.2:
**journaled filesystem（APFS / NTFS / ext4）を必須とし、exFAT と Android の
SAF は不可**。この文書はその前提の下で、今日の Awai OS（AOSP / LineageOS fork
の自前ビルド）が何を提供でき、何が未測定かを静的に切り分けるだけである。
apex の文書は変更していない。

この調査は読み取りと文書作成だけを行った。ビルド、エミュレータ / VM 起動、
実機 / USB への書込み、鍵操作、課金はしていない。したがって以下で
「確認済み」と書くのは**repo の設定、または pin した上流ファイルのコード経路**
であって、ビルド済み Awai OS image の実動作ではない。実動作はすべて
「未測定」である。

## 0. 結論

| # | 問い | 判定 |
| --- | --- | --- |
| 1 | 製品 config は USB mass storage を扱うか | **静的調査済み / 実 image は未測定**。調査対象の製品ファイルでは USB mass storage の明示設定は見つからなかった。vold は、disk source に一致する媒体を個別の fstab entry がなくても検出できる。上流の defconfig、実効 kernel 設定、ビルド済み image での USB の動作は未確認。 |
| 2 | アプリ可視経路 | **未測定（設計を満たす経路は未実装）**。通常アプリの標準経路は SAF だが §21.2 が不可とする。FUSE の `/storage/<uuid>` + `MANAGE_EXTERNAL_STORAGE` は候補だが、Awai アプリは宣言しておらず、Drive の実装は別 repo。raw `/mnt/media_rw` は DAC で隔離され、raw block を開く特権 daemon も repo に無い。 |
| 3 | ext4 USB を挿したときの挙動 | **コード経路は確認済み / image は未測定**。pin した vold は ext4 public volume を `/mnt/media_rw/<uuid>` に RW mount し、`sdcard_posix` label を付け、FUSE で `/storage/<uuid>` に出す。実際に挿して mount した記録は無い。 |
| 4 | 特権 daemon / 特権アプリを足す場合 | **未測定（変更は未実装）**。system/priv-app + privapp-permissions + SELinux + OTA/A-B + 署名の全てが必要。`/data` の FBE とは別物。 |
| 5 | VM / 実機が要る試験 | **未実施**。§6 に前提とオーナー確認の要否を列挙した。 |

APFS は、この repo の pin した manifest に実装プロジェクトが無く、Linux の
in-kernel filesystem でもないため、**今日の構成で vold 経由の経路は存在しない**。
NTFS は vold に分岐があるが、`ntfs-3g` の実行ファイルが image に入るかが
repo の product config から確認できない。**ext4 が唯一、コード経路まで確認できる
候補**である。ただし「対応している」とは書かない。実 image では未測定である。

## 1. 調査環境と境界

- ローカルに pinned の AOSP / LineageOS ソースツリーは**無い**。
  `ANDROID_BUILD_TOP` は unset。`/Users/node` 配下を `find` しても
  `system/vold` の checkout は 0 件だった。
- そのため AOSP / LineageOS の挙動は、`android/desktop/manifest/pinned-manifest.xml`
  の revision を `raw.githubusercontent.com` から**読み取り専用で取得した個別
  ファイル**で確認した。ローカルツリーの引用ではない。取得した revision は
  §7 に書く。
- repo 内の製品 config と既存 evidence を主な根拠にした。ビルド済み image、
  KVM guest、実機の USB 挿入は見ていない。
- 参考: `android/desktop/pc-ab-device/README.md:10-11` は PC A/B image に
  ついて **State: KVM only**、7735HS では何も動かしていないと明記している。
  `android/BOOT.md:9` は **Awai OS release image がまだ無い**と明記している。
  この文書の「未測定」は、その既存の境界を USB についても確認した結果である。

## 2. 製品 config が USB mass storage を扱うか

### 2.1 vold の有無

**確認済み（source の pin）**

- `android/desktop/manifest/pinned-manifest.xml:1012` が
  `system/vold` を `LineageOS/android_system_vold` revision
  `11d8982f824d52e8122c7aa732207ba66b8f23c8` で pin している。
  同じ project は `android/desktop/manifest/base/default.xml:1021` にもある。
- その revision の `vold.rc:1-10` は `service vold /system/bin/vold` を
  `class core`、`user root`、`group root reserved_disk` で起動する。
- pin した `build/make`（`90d006387398ae6899145e6531a304500cfa0f70`）の
  `target/product/base_system.mk:308` が `vold` を `PRODUCT_PACKAGES` に
  入れている。

**未測定**

- この repo には `PRODUCT_PACKAGES` を持つ製品 makefile が無い。
  `grep -rn 'PRODUCT_PACKAGES'` の repo 内ヒットは
  `pc-firmware.py:85` の `linux_firmware_r8168`、およびテスト用の
  `test_updater_feed.py:40-41` だけである。Awai の製品 config が vold を
  明示的に追加しているかは、この repo からは確認できない。
- したがって「ビルド済み Awai OS image で vold が起動している」ことは
  未測定。AOSP 標準の product に入っているという上流の事実だけでは、
  この image の起動を証明しない。

### 2.2 fstab の USB entry

**確認済み（pin した上流 fstab）**

`device/virt/virtio-common` revision
`9d5c9307434bba31d19030fcc61086efcd248997` の
`configs/fstab/fstab.virtio-common:1-9` は次の 3 種類だけを持つ。

```text
# Userdata (on separate disk)
/dev/block/vdb /data ext4 ... fileencryption,keydirectory=/metadata/vold/metadata_encryption,checkpoint=block
/dev/block/vdb /data f2fs ... fileencryption,keydirectory=/metadata/vold/metadata_encryption,fscompress,checkpoint=fs

# SD card (recovery only)
/dev/block/sda /sdcard vfat ro,defaults recoveryonly

# VirtioFS
share /mnt/vendor/shared virtiofs ...
share /mnt/vendor/shared 9p ...
```

**USB の entry は無い**。`/dev/block/sda` の 1 行は recovery 専用の SD card
であり、通常起動の USB mass storage ではない。repo 内の patch も同じ内容で、
`android/desktop/pc-ab-device/patches/virtio-userdata.patch:6-13` が
userdata と recovery SD の context を示している。

- repo の patch 適用記録 `patch-applicability-20261125.md:45` は、pin した
  base fstab が 635 bytes で `virtio-userdata.patch` の文脈に一致せず、
  実際には `virtio-userdata-block-checkpoint.patch` が選ばれると記録している。
  どちらも USB entry を持たない。

**確認済み（pin した vold）**

vold は fstab の `voldmanaged` 設定から disk source を登録する。block uevent が
その disk source に一致すると、媒体ごとの fstab entry がなくてもパーティションを
調べて `PublicVolume` を作成できる。

**未確認**

この image の実効 fstab に一致する disk source があるか、uevent が届くか、
vold が `PublicVolume` を作るかは未確認である。

### 2.3 init rc の vold 起動

**確認済み（上流）**

- pin した vold revision の `vold.rc:1-10` が service を定義している。
  これは AOSP 標準の rc で、repo の patch が追加したものではない。

**未測定**

- repo 内に `*.rc` は 0 件（`find . -name '*.rc'`）。Awai の製品 config が
  vold の rc をどう取り込むかは repo に無い。ビルド済み image の init が
  この service を開始したかは未測定。

### 2.4 kernel の USB host / OTG 設定

**確認済み（repo の fragment に無いこと）**

- `android/desktop/pc-ab-device/patches/virtio-common-awai-pc.patch:30-47` が
  追加する `configs/kernel/awai-pc.config` は、Realtek / Intel NIC、EFI
  framebuffer、AMD GPU、AMD platform、HDMI audio だけを持つ。
  `CONFIG_USB`、`CONFIG_USB_XHCI_HCD`、`CONFIG_USB_STORAGE`、`CONFIG_USB_UAS`
  の行は無い。

**未確認**

- `android/desktop/pc-ab-device/README.md:493` は、PC kernel の base を
  `gki_defconfig` と virt fragments としている。上流の defconfig と、fragment を
  適用した実効 kernel 設定は確認していない。x86_64 の host controller（xHCI）と
  `usb_storage` / `uas` が組み込まれるか、module として提供されるかは未確認。
- 参考（**別物**）: `docs/otehon/pc-persistent-install-runbook-20261123.md:102`
  は、pin した **third-party base Live image** の kernel command line で
  `module_blacklist=nvme,nvme_core,ahci,sd_mod,usb_storage,uas` を使い、
  ディスクを隠している。これは base Live image に `usb_storage` / `uas` の
  モジュール名があることの参考にはなるが、Awai の source build の設定では
  ない。
- OTG / gadget（PC が USB device になる経路）は USB mass storage host とは
  別である。`docs/otehon/android-debug-routes-design-20261121.md:101` は
  `CONFIG_USB_GADGET` 等の設定が repo の patch / 文書に見つからないと
  記録している。

### 2.5 まとめ

| 項目 | 状態 | 根拠 |
| --- | --- | --- |
| vold の source が pin されている | 確認済み | `pinned-manifest.xml:1012` |
| vold が AOSP 標準 product に入る | 確認済み（上流） | pinned `base_system.mk:308` |
| この image で vold が起動する | 未測定 | repo に製品 makefile / rc が無い |
| 調査対象の fstab に USB entry が無い | 確認済み | pinned fstab:1-9、`virtio-userdata.patch:6-13` |
| USB host / usb-storage の kernel 設定 | 未確認 | `awai-pc.config:30-47` に明示設定なし。上流の defconfig と実効 kernel 設定は未確認 |
| USB を挿して mount される | 未測定 | 実機 / VM の記録が無い |

## 3. アプリ可視経路

### 3.1 Awai アプリの種別（system / privileged / 通常）

**確認済み（APK の manifest）**

`android/build.py:38-46` が生成する manifest の permission は次のとおり。

- Home: `READ_AGENDA`（自前 signature permission）、`SET_WALLPAPER`、
  `ACCESS_NETWORK_STATE`、`INTERNET`、`HIDE_OVERLAY_WINDOWS`。
- Store: `REQUEST_INSTALL_PACKAGES`、`UPDATE_PACKAGES_WITHOUT_USER_ACTION`、
  online build のときだけ `INTERNET` 等。
- Yotei: 自前の `READ_AGENDA` signature permission。

**`MANAGE_EXTERNAL_STORAGE` はどの manifest にも無い**。repo 全体の
`grep -rn 'MANAGE_EXTERNAL_STORAGE'` も 0 件である。

**確認済み（配布経路ごとに違う）**

- `android/BOOT.md:63` は「Every route installs the same APKs」と書き、
  `android/BOOT.md:116-119` は phone route で `adb install` し、Home は
  **ordinary app** だと明記する。この経路では system app でも privileged app
  でもない。
- `android/desktop/derived-image/build-images.sh:18-38` は、third-party base
  image の `/system/product/app/AwaiHome`、`AwaiStore`、`AwaiYotei` に APK を
  置き、`u:object_r:system_file:s0` を付ける。`vm-boot-20261117.json:14-19`
  は Home の flags を **SYSTEM** と記録している。
- ただしこれは **derived development image**（third-party prebuilt base +
  Awai APK）であり、AOSP / LineageOS fork の source build ではない
  （`android/desktop/derived-image/README.md:13`）。source build で同じ配置に
  なることを示す `PRODUCT_PACKAGES` は repo に無い。
- `/system/product/app` は `priv-app` ではない。repo に
  `privapp-permissions` / `priv-app` の製品 config は無い
  （`grep -rn 'privapp-permissions\|priv-app'` のヒットはテストと
  SystemUI の既存イメージ操作だけ）。

**Drive**

`apps/drive/README.md:1-6` は、Android / macOS の Tauri source、build、
test が `network-awai/app-drive` にあり、package ID は
`network.awai.drive` だとだけ書く。この repo に Drive の APK / manifest /
配置 config は無い。したがって Drive が system / privileged / 通常 app の
どれかは、**この repo からは確認できない**。

### 3.2 経路 (a): `/mnt/media_rw` の raw path

**確認済み（pin した vold）**

- `PublicVolume.cpp:134` が raw path を
  `/mnt/media_rw/<stableName>` に固定する。
- `PublicVolume.cpp:148` がその mount point を
  `fs_prepare_dir(..., 0700, AID_ROOT, AID_ROOT)` で作る。
- `system/core` の pinned `rootdir/init.rc:300` は
  `mkdir /mnt/media_rw 0750 root external_storage` とする。
- ext4 portable の mount では、`Ext4.cpp:135` が
  `context=u:object_r:sdcard_posix:s0` を付け、`:154-155` で mounted root を
  `media_rw:media_rw`、`0775` にする。

つまり raw path は root / `external_storage` group の DAC と SELinux の
対象で、**通常アプリの API ではない**。`MANAGE_EXTERNAL_STORAGE` は
shared storage の appop であり、`/mnt/media_rw` の DAC を迂回するものでは
ない（AOSP 一般論）。`MANAGE_EXTERNAL_STORAGE` を持つアプリが見るのは
FUSE 側の `/storage/<uuid>` である。

**未測定**

- repo に raw path を使う特権 daemon / system app は無い。
- ext4 の `sdcard_posix` label で通常アプリが読めるかは、実際の
  `file_contexts` / `sepolicy` と FUSE の設定に依存する。repo には
  `sdcard_posix` / `media_rw_data_file` の policy が無い
  （`grep -rn 'sdcard_posix\|media_rw_data_file'` は 0 件）。実 image の
  SELinux denial も未測定。

### 3.3 経路 (b): SAF / DocumentsProvider

**確認済み（設計が不可とする）**

- apex §21.2 が **Android の SAF は不可**と明記している。理由は dirty な
  抜去で filesystem 自体が壊れうることで、FS probe（§4.9）でも拒否する。
- repo 内で SAF を使う記述は、`packages/awai-inference/README.md:11` の
  「native SAF import for the exact pinned model」だけである。これは推論
  モデルのファイル取り込みであり、Portable-USB の volume を読む経路では
  ない。

**未測定**

- AOSP の DocumentsProvider / ExternalStorageProvider が ext4 の public
  volume をどう見せるかは、実 image で確認していない。設計上は使わない。

### 3.4 経路 (c): raw block device

**確認済み（repo に無い）**

- `/dev/block/*` を開く daemon / privileged app は repo に無い。
- `vold` 自身は root で動くが、アプリに raw block を渡す API ではない
  （`vold.rc:1-10`）。
- apex §17.3 は、端末の raw block を開く権限を R4〜R6 で誰が与えるかは
  **未決定**であり、実機への書込みはオーナー確認が要るとしている。

**未測定**

- raw block を開く新しい daemon の SELinux domain、device node の label、
  OTA への入れ方は未実装・未測定。

### 3.5 まとめ

| 経路 | 今日の状態 | 設計との関係 |
| --- | --- | --- |
| (a) `/mnt/media_rw` raw | DAC 0700 root / 0750 root:external_storage。通常アプリ不可。特権 daemon は repo に無い | 新規の特権コンポーネントが必要 |
| (a') FUSE `/storage/<uuid>` + `MANAGE_EXTERNAL_STORAGE` | AOSP の public volume の app-visible view。Awai アプリは未宣言、Drive は別 repo、実装・実測なし | SAF ではないが、未実装・未測定 |
| (b) SAF / DocumentsProvider | AOSP にはあるが、§21.2 が不可とする | 設計で拒否 |
| (c) raw block `/dev/block/*` | repo に daemon 無し。apex §17.3 で権限未決定 | 新規の特権 daemon とオーナー確認が必要 |

**結論**: 今日の repo の config だけでは、§21.2 を満たすアプリ可視経路は
確認できない。唯一の実装候補は (a') だが、Awai アプリ側の宣言・実装・実測が
無い。SAF は設計で不可、raw path / raw block は特権コンポーネントの追加が
必要である。

## 4. ext4 の USB を挿したときの挙動

### 4.1 vold の ext4 経路（pin した source）

**確認済み（コード経路）**

pin した `system/vold` revision `11d8982f...` の
`model/PublicVolume.cpp` は次の順で動く。

1. `:127` `IsFilesystemSupported(mFsType)` で `/proc/filesystems` に
   filesystem があるか確認する。
2. `:134` raw path を `/mnt/media_rw/<stableName>` にする。
3. `:157` ext4 なら `ext4::Check(mDevPath, mRawPath, false)`。
4. `:178` ext4 なら
   `ext4::Mount(mDevPath, mRawPath, false, false, true, mMntOpts, false, true)`
   で mount する。第 1 引数の `ro=false`、最後の `portable=true`。
5. `:271-276` で `MountUserFuse` を呼び、`/storage/<stableName>` を
   app-visible にする。

`model/Ext4.cpp`:

- `:56-61` `kMkfsPath=/system/bin/mke2fs`、`kFsckPath=/system/bin/e2fsck`、
  `IsFilesystemSupported("ext4")`。
- `:135` portable mount に `context=u:object_r:sdcard_posix:s0` を追加。
- `:154-155` mount 後に `chown(media_rw, media_rw)`、`chmod(0775)`。
- `:199` format 時の options に `has_journal` を入れる（vold が format する
  場合は journal 付き ext4）。ただし、既に存在する ext4 に journal があるか
  は vold の mount では判定しない。journal の有無の判定は apex §4.9 の
  FS probe 側の責務である。

したがって **pin した vold のコード経路としては、ext4 の USB を
public volume として RW mount し、`sdcard_posix` label を付け、FUSE で
`/storage/<uuid>` に出す**。これは「実 image でそうなった」ではない。

### 4.2 SELinux label

**確認済み（コード経路）**

- ext4 portable の label は **`u:object_r:sdcard_posix:s0`** であり、
  `media_rw_data_file` ではない（`Ext4.cpp:135`）。
- `media_rw_data_file` は AOSP の `/data/media` 側の型で、この repo には
  定義も使用も無い（`grep` 0 件）。

**未測定**

- 実 image の `file_contexts` が `sdcard_posix` を許可し、通常アプリの
  domain がそれを読めるか。FUSE 経由の access と raw path の access は
  別であり、どちらも実機で確認していない。

### 4.3 NTFS / APFS / exFAT

| FS | 今日の状態 | 根拠 |
| --- | --- | --- |
| ext4 | pin した vold に mount 経路あり。image は未測定 | `PublicVolume.cpp:157,178`、`Ext4.cpp:135,199` |
| NTFS | vold に分岐あり。ただし `/system/bin/{mkfs,fsck,mount}.ntfs` が必要 | `Ntfs.cpp:33-41`。`ntfs-3g` は `pinned-manifest.xml:1112` にあるが、product への同梱は repo で未確認 |
| APFS | vold の fs type に無い。manifest に APFS 実装プロジェクトが無い | `grep -niE 'apfs' pinned-manifest.xml` 0 件。Linux の in-kernel FS ではない |
| exFAT | vold に mount 経路あり。ただし §21.2 が不可とする | `PublicVolume.cpp:154,174`、apex §21.2 |

NTFS の `IsSupported()` は `mkfs.ntfs` / `fsck.ntfs` / `mount.ntfs` の
実行可能性と `IsFilesystemSupported("ntfs")` を要求する
（`Ntfs.cpp:37-40`）。`Utils.cpp:1095-1104` は `/proc/filesystems` に
`fuse\tntfs` を追加して判定する。つまり NTFS は **ntfs-3g (FUSE) の
実行ファイルが image に入っていること**が前提で、その同梱は repo の
product config から確認できない。

### 4.4 「AOSP 一般論」と「本 image」の区別

- vold のコード経路、fstab の不在、init の `/mnt/media_rw` の DAC は、
  pin した上流ファイルで確認した。
- 「USB を挿すと uevent が届く」「vold が PublicVolume を作る」
  「FUSE が `/storage/<uuid>` を出す」「通常アプリが read/write できる」
  「dirty unplug で journal が回復する」は、**すべて本 image では未測定**。
  AOSP 一般論を本 image の対応とは書かない。

## 5. 特権 daemon / 特権アプリを足す場合の帰結

これは設計判断ではなく、追加した場合に必要になるものを列挙する。
今日の repo には実装が無い。

### 5.1 配置と権限

- privileged app は `/system/priv-app`、`/system_ext/priv-app`、
  `/product/priv-app`、`/vendor/priv-app` のいずれかに置く必要がある
  （AOSP 一般論）。`/system/product/app` の system app（§3.1）は
  privileged ではない。
- privileged permission を使うには `privapp-permissions-*.xml` の
  allowlist が必要（AOSP の user build は allowlist 外を拒否する）。
  repo にこの XML は無い。
- Store から `/data` にインストールした APK は privileged になれない。
  特権コンポーネントは image に入れて OTA で更新するしかない。

### 5.2 署名

- `android/release-signing/verify-selinux-policy.py:14` は
  `platform`, `networkstack`, `media`, `bluetooth`, `nfc`, `sdk_sandbox` の
  6 role を必須とし、`:47` で target-files の `*_mac_permissions.xml` を
  読み、`:86-87` で substitution の欠落を拒否する。
- `android/release-signing/README.md:33-43` は、releasetools が
  target-files の X.509 証明書を release 証明書に置換し、その結果を
  `verify-selinux-policy.py` で確認すると書く。
- したがって、新しい privileged app が `platform` などの signature
  permission を使うなら、その APK の署名証明書を key plan に入れ、
  `mac_permissions.xml` の置換を検証する必要がある。**鍵の生成・操作は
  この調査ではしていない**。
- `verify-selinux-policy.py` が見るのは `mac_permissions.xml` の証明書
  置換だけであり、SELinux の domain / allow rule の意味は検証しない。

### 5.3 SELinux policy

- repo の sepolicy patch は、`virtio-common-awai-pc.patch:57-74` で
  `/dev/block/by-name/{persist,metadata,boot_*,vendor_boot_*,super,misc,userdata}`
  の label を足すだけである。USB mass storage、`sdcard_posix`、
  `media_rw_data_file`、raw block の domain は無い。
- 特権 daemon を足すなら、新しい domain、device node の label、
  `neverallow` を通る allow rule、`file_contexts` が必要。policy の
  意味は release signing の検証対象外なので、別の受入が要る。
- `sdcard_posix` は vold の mount option で付くが、その型を通常アプリの
  domain が read/write できるかは実 image の policy 次第である（未測定）。

### 5.4 OTA / A-B との関係

- `virt-common-awai-pc.patch:9-14` は `AB_OTA_PARTITIONS :=
  $(ALL_PARTITIONS) boot vendor_boot` とし、ESP と BIOS を OTA の対象から
  外す。`ALL_PARTITIONS` の定義はこの repo に無いが、その一覧に含まれる
  system 系 / vendor の partition は OTA payload の対象になる。
- privileged app / daemon をこれらの partition に置くと、その追加は
  OTA payload と vbmeta / AVB の対象になる。A/B の両 slot に必要で、
  rollback も考える必要がある（`README.md:477-480` の A/B OTA 記録は
  KVM の test key であり、release key の受入ではない）。
- `/data` に置くだけでは privileged にならない。Store の APK 更新経路
  （`build.py:46` の `REQUEST_INSTALL_PACKAGES`）は通常アプリの更新で
  あり、特権の昇格ではない。

### 5.5 `/data` の FBE との別物であること

- `/data` は pinned fstab:2 で ext4 + `fileencryption` +
  `keydirectory=/metadata/vold/metadata_encryption` + `checkpoint=block`。
  これは **内蔵 `/data` の file-based encryption** である。
- USB の public volume は vold が mount する removable media で、`/data`
  の FBE の対象ではない。ext4 portable の label は `sdcard_posix` で、
  `/data` の `media_rw_data_file` とは別である。
- apex §21.1 は Portable-USB を「hosted-file の暗号化単一 container +
  sidecar」とし、§17.3 は container の区画を `AB_OTA_PARTITIONS` にも
  vbmeta の鎖にも入れないとする。§17.5 の `/data` 置き換え（R6）は
  別 gate で、オーナー確認が要る。
- したがって特権 daemon が USB のファイルを開いても、それは `/data` の
  FBE を迂回したことにも、Portable-USB の container 暗号を実装したことにも
  ならない。

## 6. VM / 実機が要る試験

以下は**未実施**。VM は実機の USB hotplug / OTG host / firmware を
置き換えない。実機の試験は、書込みを伴うものにオーナー確認が要る。
user build には shell が無いため、読み取りにも承認済みの debug route
（AWAI-3682）が必要である。

| # | 試験 | 前提 | 書込み / オーナー確認 | 記録するもの |
| --- | --- | --- | --- | --- |
| V1 | USB host の列挙 | 7735HS / 6600H の実機、USB-A host port、空き USB stick | 読取りのみ（挿すだけ） | `dmesg` の xHCI / usb-storage / uas、`lsusb`、`ls /sys/block` |
| V2 | vold が ext4 を public volume にする | V1 + あらかじめ ext4 で format 済みの stick（format 自体が書込み） | format と mount は媒体への書込み。オーナー確認 | `dumpsys mount`、`sm list-volumes`、`ls -Z /mnt/media_rw`、`ls -Z /storage`、`getprop` |
| V3 | アプリから read | V2 + 試験用 APK（`MANAGE_EXTERNAL_STORAGE` または特権配置）。実装は未着手 | read のみ | `/proc/<pid>/mountinfo`、open/read の結果、SELinux `avc: denied` |
| V4 | アプリから write + fsync | V3 + 使い捨て stick | **書込み。オーナー確認** | write、`FileDescriptor.sync()`、readback、`e2fsck -n` |
| V5 | dirty unplug / 再挿入 | V4 + 使い捨て stick | **破壊試験。オーナー確認** | 挿抜の時刻、`dmesg`、`e2fsck -n`、journal recovery、再 mount の成否 |
| V6 | SELinux denial の有無 | V2〜V5 + 承認済み debug route | 読取りのみ（policy 変更は別） | `avc: denied`、`ls -Z`、`sesearch` の結果 |
| V7 | NTFS の可否 | V1 + NTFS stick + image に `ntfs-3g` が入っていること | mount は read-only なら読取り。write はオーナー確認 | `/proc/filesystems` の `fuse`/`ntfs`、`/system/bin/mount.ntfs` の有無、mount 結果 |
| V8 | APFS の負の対照 | V1 + APFS stick | 読取りのみ | mount されないこと、`vold` の log、`blkid` の結果 |
| V9 | 特権 app / daemon の OTA / A-B | source build、署名、A/B OTA 環境 | **build / flash / OTA はオーナー確認** | 両 slot の package、vbmeta、rollback、`privapp-permissions` |
| V10 | `/data` FBE との分離 | V2 + userdata の FBE 状態 | 読取りのみ | `getprop`、`dumpsys mount`、`/data` と `/storage/<uuid>` の label / key の別 |

追加の前提:

- V1〜V8 は実機の USB controller / firmware に依存する。QEMU の
  `-device usb-storage` は hotplug の試験には使えるが、実機の xHCI、
  OTG host、給電、firmware の受入にはならない。
- V2 の ext4 format は、その stick の既存データを消す。**使い捨て媒体と
  オーナー確認**が前提。
- V4 / V5 の dirty unplug は、journal が回復するかを見る破壊試験である。
  既存の Portable-USB のデータでは行わない。
- V9 は release key / OTA / A/B の受入であり、この調査の範囲外。鍵の生成・
  操作は別のオーナー確認が要る。

## 7. 参照したファイルと revision

repo 内:

- `android/desktop/pc-ab-device/README.md:10-11,493`
- `android/BOOT.md:9,63,116-119`
- `android/build.py:38-46`
- `android/desktop/derived-image/README.md:13`
- `android/desktop/derived-image/build-images.sh:18-38`
- `android/desktop/derived-image/evidence/vm-boot-20261117.json:14-19`
- `android/desktop/pc-ab-device/pc-firmware.py:85`
- `android/desktop/pc-ab-device/patch-applicability-20261125.md:45`
- `android/desktop/pc-ab-device/patches/virtio-userdata.patch:6-13`
- `android/desktop/pc-ab-device/patches/virtio-common-awai-pc.patch:30-47,57-74`
- `android/desktop/pc-ab-device/patches/virt-common-awai-pc.patch:9-14`
- `android/desktop/manifest/pinned-manifest.xml:141,315,1012,1107,1112`
- `android/desktop/manifest/base/default.xml:1021`
- `android/release-signing/README.md:33-43`
- `android/release-signing/verify-selinux-policy.py:14,47,86-87`
- `apps/drive/README.md:1-6`
- `packages/awai-inference/README.md:11`
- `docs/otehon/android-debug-routes-design-20261121.md:101`
- `docs/otehon/pc-persistent-install-runbook-20261123.md:102`

pin した上流（ローカルツリーではない。revision は
`android/desktop/manifest/pinned-manifest.xml`）:

- `LineageOS/android_system_vold` `11d8982f824d52e8122c7aa732207ba66b8f23c8`
  - `main.cpp:241-301`、`VolumeManager.cpp:201-244`、`model/Disk.cpp:421-454`
  - `model/PublicVolume.cpp:127,134,143,148,157,178,271-276`
  - `model/Ext4.cpp:56-61,135,154-155,199`
  - `model/Ntfs.cpp:33-41`
  - `Utils.cpp:1095-1104`
  - `vold.rc:1-10`
- `LineageOS/android_system_core` `65d661b1a536701e8b118be4e9728d7b5ca727c9`
  - `rootdir/init.rc:300`
- `LineageOS/android_build` `90d006387398ae6899145e6531a304500cfa0f70`
  - `target/product/base_system.mk:308`
- `LineageOS/android_device_virt_virtio-common`
  `9d5c9307434bba31d19030fcc61086efcd248997`
  - `configs/fstab/fstab.virtio-common:1-9`

設計（別 repo）:

- `network-awai/network-awai-apex` PR #381（merged、head
  `647d36cf3cb139f5acb98fe7b8fc77179cf77df9`）
  `docs/awai-disk-format.md`
  - §21.2（journaled FS 必須、exFAT / SAF 不可）
  - §21.1（Portable-USB は hosted-file container + sidecar）
  - §4.9（FS probe、`FileDescriptor.sync()`）
  - §17.3（raw block 権限は未決定、container は AB_OTA_PARTITIONS /
    vbmeta の外）
  - §17.5（`/data` 置き換えは R6、オーナー確認）

## 8. 使用したコマンド（要約）

読み取りのみ。出力はこの文書の該当箇所に引用した。

```sh
# repo と基点
git rev-parse HEAD origin/main

# ローカルに AOSP/LineageOS ツリーがあるか
echo "${ANDROID_BUILD_TOP:-unset}"
find /Users/node -maxdepth 5 -type d -path '*/system/vold'
find . -name '*defconfig*' -o -name 'fstab*' -o -name '*.rc'

# 製品 config / アプリ manifest / 特権設定
grep -rn 'PRODUCT_PACKAGES' --exclude-dir=.git .
grep -rn 'MANAGE_EXTERNAL_STORAGE' --exclude-dir=.git .
grep -rn 'media_rw\|sdcard_posix' --exclude-dir=.git .
grep -rn 'privapp-permissions\|priv-app' --exclude-dir=.git .
grep -n 'system/vold' android/desktop/manifest/pinned-manifest.xml

# pin した上流ファイル（read-only）
curl -s https://raw.githubusercontent.com/LineageOS/android_system_vold/11d8982f824d52e8122c7aa732207ba66b8f23c8/model/PublicVolume.cpp
curl -s https://raw.githubusercontent.com/LineageOS/android_system_vold/11d8982f824d52e8122c7aa732207ba66b8f23c8/model/Ext4.cpp
curl -s https://raw.githubusercontent.com/LineageOS/android_system_vold/11d8982f824d52e8122c7aa732207ba66b8f23c8/model/Ntfs.cpp
curl -s https://raw.githubusercontent.com/LineageOS/android_system_vold/11d8982f824d52e8122c7aa732207ba66b8f23c8/Utils.cpp
curl -s https://raw.githubusercontent.com/LineageOS/android_system_core/65d661b1a536701e8b118be4e9728d7b5ca727c9/rootdir/init.rc
curl -s https://raw.githubusercontent.com/LineageOS/android_build/90d006387398ae6899145e6531a304500cfa0f70/target/product/base_system.mk
curl -s https://raw.githubusercontent.com/LineageOS/android_device_virt_virtio-common/9d5c9307434bba31d19030fcc61086efcd248997/configs/fstab/fstab.virtio-common

# 設計
gh pr view 381 --repo network-awai/network-awai-apex --json headRefOid,state
gh api repos/network-awai/network-awai-apex/contents/docs/awai-disk-format.md?ref=refs/pull/381/head
```

## 9. 未測定の一覧（再掲）

- ビルド済み Awai OS image で vold が起動し、USB の uevent を処理すること。
- 実機の xHCI / USB host / usb-storage / uas の設定。
- ext4 USB を挿したときの実際の mount、`/storage/<uuid>` の生成、
  `sdcard_posix` label での app access。
- 通常アプリ（`MANAGE_EXTERNAL_STORAGE` あり / なし）の read/write、
  `FileDescriptor.sync()` の結果。
- dirty unplug 後の journal 回復、再挿入、`volume-absent` の挙動。
- NTFS の `ntfs-3g` 同梱と mount。
- 特権 app / daemon の配置、privapp-permissions、SELinux policy、署名、
  OTA / A-B、rollback。
- `/data` の FBE と USB public volume の分離の実機確認。
