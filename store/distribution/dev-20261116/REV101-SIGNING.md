# catalog revision 101（Itonami 追加）— 署名待ちメモ

rev100（Yotei のみ、署名済み `catalog-envelope.json`）に Itonami を追加した
rev101 の素（`catalog-rev101-raw.json`）と実機検証済み APK（`itonami.apk`）。
envelope 署名は root 開発鍵の保持者（owner）が行う。署名前の本ファイル群は
Store 消費者（`Catalog.verifyMetadata`）に受理されない（fail closed のまま）。

## 内容

- `catalog-rev101-raw.json`: schema `itonami.store.bundled.v1`、revision 101。
  Yotei エントリは rev100 のバイト列をそのまま保持。新規 Itonami エントリは
  `apps[1]` に追加のみ。既存単一アプリ前提の検証は変えていない。
- `itonami.apk`: package `network.itonami.app`、versionCode 1000 / 0.1.0、
  x86_64 debug。bytes 32685869、
  sha256 `673fcaffafbf63dc6e6c927039a414a28dc6292e624cbb5a3bf399ca1f2c697f`、
  signer SHA-256 `2507930b6c21b3c1cd0655527227dba75772096eff85e887bfcce2fb25b49b29`
 （Yotei dev と同一の Android development debug 署名。本番鍵ではない）。
- 有効期限は生成時 +30 日（開発 preview の運用を踏襲）。

## 署名手順（鍵保持者用）

素 JSON の正確な UTF-8 バイト列に RSA(SHA-256) 署名し、envelope 化する。
生成コマンド（再現・検証用。鍵は含まない）:

```sh
python3 - <<'EOF'
import json
raw = open('store/distribution/dev-20261116/catalog-rev101-raw.json','rb').read().rstrip(b'\n')
print('raw bytes:', len(raw))
EOF
node -e "const{sign}=require('node:crypto');const fs=require('fs');\
const raw=fs.readFileSync('store/distribution/dev-20261116/catalog-rev101-raw.json','utf8').replace(/\n$/,'');\
const key=fs.readFileSync('/path/to/dev-private.pem');\
const sig=sign('sha256',Buffer.from(raw,'utf8'),key).toString('base64');\
fs.writeFileSync('store/distribution/dev-20261116/catalog-envelope.json',JSON.stringify({raw,signature:sig}));"
```

署名後は `EVIDENCE-itonami-20261116.md` の取得手順でデバイス受理を確認する。
`Catalog.java` は現状 Yotei 単一前提（`apps.length()!=1` 拒否・asset 固定・
20MB 上限・online ファイル名固定）のため、Itonami の実機 Store 受理には
別途クライアント一般化（[AWAI-3003](https://linear.app/kotobalabs/issue/AWAI-3003) 予定）
と鍵保持者による host 側の公開鍵 pin 更新・利用者承認が必要。
