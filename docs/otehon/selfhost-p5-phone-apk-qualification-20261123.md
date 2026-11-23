# Self-hosting P5 次: community AArch64 SDK での Home APK phone 内生成

[AWAI-3879](https://linear.app/kotobalabs/issue/AWAI-3879)（親 [AWAI-3853](https://linear.app/kotobalabs/issue/AWAI-3853)、
前段 [AWAI-3878](https://linear.app/kotobalabs/issue/AWAI-3878)）、2026-11-23。
結論: **Home の debug APK は phone 単体で生成と署名まで通った。** 正式な
release 署名や Store 配布の資格ではない。

## pin と取得

| 対象 | 固定値 |
| --- | --- |
| community SDK | `kaspersigi/android-sdk-linux-aarch64` v1.0.12、`android-sdk-linux.zip` 1,075,905,410 bytes、SHA-256 `23f7a657cf12db907b82c6b743ea93ddb84b0e1fe96a680a6a2287587f78a9de`（配布元の `.sha256` と一致） |
| glibc shim | Debian trixie `libc6_2.41-12+deb13u5_arm64.deb`、SHA-256 `0966fc3da1a26cc57647c68b5736f791b6e7eb498173a7993f63b6c89b4ed4f5` |
| babashka | v1.13.230 `linux-aarch64-static`、SHA-256 `d3935b08e8e2e81d1dd56be0ad72715cf1ebcd01cae6f8a6c909b5e4faa23884d` |

## 通した手順と、名前付きの失敗

1. SDK を guest の `/opt/android-sdk-aarch64` に展開。python の zip 展開は
   実行ビットを落とすため `chmod +x` が要る。
2. `aapt2` は AArch64 ELF だが `GLIBC_2.38 not found`（guest は bookworm の
   glibc 2.36）。分離した glibc 2.41 の loader 経由で実行すると
   `Android Asset Packaging Tool (aapt) 2.20-13193326` が返る。
3. `build.py` の要求（`build-tools/36.1.0`、`platforms/android-37.0`）に対し、
   guest 内 layout（ELF は loader wrapper、d8/apksigner は bash script として
   実体を呼ぶ wrapper、platform は android-36 への symlink）で合わせた。
4. catalog 署名鍵は Mac の開発鍵を持ち込まず、phone 内で root/catalog/pointer
   の開発鍵を生成し、`--allow-sequence` の別 channel として key list を署名・
   検証した（verify 終了コード 0）。資格化専用の鍵であり、公開済み開発 root
   の信頼とは別。
5. `otehon/shell` の `npm ci`（8.9 s）と babashka の導入後に build が進み、
   `python3 android/build.py --version 1 --skip-cljs --home-only --unsigned-home`
   が 34.1 s で終了コード 0。
6. guest 内で debug keystore を生成して署名し、Mac 側でも独立に検証した。

## 結果

- `home-v1-unsigned.apk` 4,326,670 bytes、SHA-256
  `7517b9aeb05b204b336ce54cf6d873d2ae38f11a387cfb0bbbc75c05a52843df`。
- 署名後 `home-v1-signed.apk` 4,339,152 bytes、SHA-256
  `506e5f87dc3b9b19e96a2e362b22dc98b08c5204babe14e43d8dc63e34989a82`。
  badging は `network.awai.home`、versionCode 1、targetSdk 37。
  Mac の apksigner で `Verifies`、v3 scheme true、署名者 1。
- 証跡 APK は `github/workspaces/muse/awai-3879-phone-apk/` に保存した。

## P5 決定の更新

AWAI-3878 の決定 2（資格化を試す）は Home debug について成立した。
残りは未資格のまま: 公式 SDK の arm64 配布（引き続き無し）、release 署名、
Store への同梱、Tauri app の build、`--skip-cljs` を外した ClojureScript
build。これらを通すまでは、phone 単体 build を Home debug 以外に広げて
主張しない。
