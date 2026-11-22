# Self-hosting P5: phone (arm64) の APK ビルド可否

[AWAI-3878](https://linear.app/kotobalabs/issue/AWAI-3878)（親 [AWAI-3853](https://linear.app/kotobalabs/issue/AWAI-3853)）、2026-11-23。
調査のみ。端末へのインストールや build は行っていない。

## 公式配布: arm64 host tool は無い（一次資料で再確認）

- `https://dl.google.com/android/repository/repository2-1.xml`（2026-11-23 取得、
  remotePackage 311 件）で、host-os は windows / linux / macosx のみ、
  `arm64` / `aarch64` を含む archive URL は 0 件。
- AWAI-3565 の実測どおり、linux 向け host tool（cmdline-tools、build-tools、
  NDK）は x86_64 ELF で、arm64 の guest では実行できない。

したがって公式 SDK では phone 単体 APK ビルドの経路はない。

## community の固定 SDK: 候補はあるが未資格

- `kaspersigi/android-sdk-linux-aarch64` は、checksum 検証済み Release から
  組み立てた固定の AArch64 SDK（Build-Tools 36.0.0、NDK r30 系）を配布し、
  AGP の x86_64 aapt2 を `android.aapt2FromMavenOverride` で置き換える手順まで
  一次資料（同 repo の README）に書かれている。
- 同 README 自身が「native AArch64 の device/debugger や任意の Gradle 案件の
  成立は示さない」と限定している。Tauri や `android/build.py` のような
  Gradle 以外の経路での成立も未検証。
- よって、これは「可能になった」ではなく「資格化の候補」として扱う。

## 決定

1. 正式経路は当面、端末駆動のリモートビルド（端末が要求・検証・適用を担う）
   とし、phone 単体 build は `deferred` として issue を開いたままにする。
   Mac への黙った fallback はしない。
2. 次の単位で community 固定 SDK の資格化を試す: pinned Release の digest を
   固定し、phone の proot 内で `aapt2 version` の実行と、Awai アプリ
   （Home の debug APK）の生成までを通す。通らなければ理由を名前付きで
   記録し、決定 1 を維持する。
3. 公式に arm64 host tool が出た場合は、その時点で本決定を見直す。

## 出典

- Google SDK repository 一覧（上記 URL、2026-11-23 取得時の集計）。
- `kaspersigi/android-sdk-linux-aarch64` README（同日確認）。
- AWAI-3565 の phone 実測（SDK archive の ELF 判定）。
