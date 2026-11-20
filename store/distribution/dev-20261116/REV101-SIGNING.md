# catalog revision 101（Itonami 追加）— 署名済み

rev100（Yotei のみ）に Itonami を追加した rev101 を `catalog-envelope.json` に
署名済みで収録。署名は AWAI-2977 と同一の開発 debug 鍵（`~/.android/debug.keystore`、
fp `2507930b…`。秘密鍵は repo 外）で `android/SignCatalog.java` と同一方式
（SHA256withRSA over raw UTF-8 bytes）により実施。署名前の素は
`catalog-rev101-raw.json` に残す（envelope.raw と同一内容。末尾改行なしは
rev100 の形式に合わせた）。

## 内容

- `catalog-rev101-raw.json`: schema `itonami.store.bundled.v1`、revision 101。
  Yotei エントリは rev100 の値をそのまま保持。新規 Itonami エントリは
  `apps[1]` に追加。承認層（`Catalog.java`＋共有 domain）は本 PR で多アプリ化。
- `itonami.apk`: package `network.itonami.app`、versionCode 1000 / 0.1.0、
  x86_64 debug。bytes 32644749、
  sha256 `09e92086e6b5edde9c91804a4fc30b6c980299cd64d4924a2f1c65e74e9da5cb`、
  signer SHA-256 `2507930b6c21b3c1cd0655527227dba75772096eff85e887bfcce2fb25b49b29`
 （Yotei dev と同一の Android development debug 署名。本番鍵ではない）。
- 有効期限は生成時 +30 日（開発 preview の運用を踏襲）。

## 署名の再現・検証（鍵は含まない）

実施内容: `catalog-rev101-raw.json` の正確な UTF-8 バイト列に
`android/SignCatalog.java` と同一方式（SHA256withRSA、開発 debug 鍵）で署名し
`catalog-envelope.json`（`{raw, signature(base64)}`）に収録。検証:
`openssl dgst -sha256 -verify <dev-pub.pem>` で OK、
repo 正規経路 `authenticateCatalog`（実 envelope＋実鍵＋再ビルド domain.js）で
rev101 受理、改ざん 3 件（bytes 書換・entry 削除・asset 差替）は拒否。

## 検証済み（2026-11-16、すべて開発 debug 署名の範囲）

- repo 正規経路 `authenticateCatalog` で実 envelope を受理（Yotei@4 + Itonami@1000）。
  改ざん（bytes 書換・entry 削除・asset 差替）は拒否。node 7/7 pass。
- 実機 `am instrument`: `Awai Android store integrity: 13 assertions passed`
 （従来 10 + Itonami 版・APK・unknown 拒否 3）。同梱 rev101 カタログの署名・
  有効期限、Itonami 32.7MB の bytes/sha256/package/versionCode/signer と
  インストール済み署名の一致を確認。Yotei 側の検証も全通（互換維持）。
- 再ビルド Store（同梱 rev101）を実機に install し discover 画面を目視
 （`store-rev101-ui-20261116.png`）。Yotei 一覧は変化なし。
  Itonami の一覧表示・詳細・追加フロー UI は未実装（Figma 基準の設計が前提の別工程）。

## 残り（owner 側）

- オンライン経路での rev101 受理（固定 URL 取得）は利用者の canonical broker 承認が
  要る。merge 後の固定 commit に対する pins（catalog URL＋sha256 `cdfba84b…`、
  apk URL＋sha256）で承認依頼を出す。詳細は
  [AWAI-3003](https://linear.app/kotobalabs/issue/AWAI-3003)。
- production 鍵・ROM 組込は別 scope。
