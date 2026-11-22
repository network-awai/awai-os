# Itonami Store 入口ページの公開記録（2026-11-21、AWAI-3731）

`https://store.itonami.app/` で Store の入口ページを公開した。配信は Cloudflare の名前の面
（`yataverse-bytes` Worker、account `cloud-kotoba`）。

## 決定

- host は `store.itonami.app`（owner 決定 2026-11-21）。
- node 側の入口が止まっているので、Cloudflare で先に出す（owner 指示 2026-11-21）。
- 主は node、Cloudflare は予備、という決定（network-awai-apex `docs/itonami-domain-unification-design.md` §8.7）は変えていない。
  node が戻ったら、`store.itonami.app` に DNS-only の A レコードを足すと node へ向く。同じ root を node に pin する手順は未実施。

新しい Worker、route、request 時の handler は足していない。使ったのは、同日に有効になった名前の面
（JUN-1425、route `*.itonami.app/*`）と、TXT レコード 1 本。

## 公開したもの

| 項目 | 値 |
|---|---|
| source | `network-awai/awai-os` main `1661571dab184fce1f8b05ec48d276d851e5eb04`、`node store/site/build.mjs --out <dir>`（Node 26.0.0） |
| pointer | sequence 3、catalog r109、app 8 件、期限 2026-12-21T07:54:08Z |
| UnixFS root | `bafybeig2il3xsh5otravyl7pwsy6qy2cxo73gteij6hercxsepxsv4glpy`（4 ファイル、5 block、CAR 1 個 42,667 bytes） |
| pack の道具 | `network-awai/app-itonami-yataverse` main `91d3c55c5b3df3d7e82e6843e433c349b2b69dd1` の `yataverse site-pack` |
| 書き込み | `yataverse car-put`、2026-11-21T14:51:57Z に受理。`verified: true`、`receiptVerified: true`、receipt `bafyreifpamontjjkqquubvb3e7ojjz4h3m6x3xif7iygyjiknhhcrlw72m` |
| DNS | TXT `_dnslink.store.itonami.app` = `dnslink=/ipfs/<root>`。新規 1 本、TTL Auto、DNS only。Cloudflare の dashboard で 14:53Z ごろ追加。追加前に `store` を含むレコードが無いことを確認 |

| ファイル | SHA-256 |
|---|---|
| `index.html` | `b2cd9470f2aa00652cd76de3e6dd252adbafe02e212aa69bf39ed654f8193823` |
| `style.css` | `f1280b5669e07746c4216cd68762131db28a7cbbedc92e0552ab652191d1393b` |
| `logo.png` | `04cf2339835973db14dc84ef1d797cf74ddc82f4094429caaa3f869d40185444` |
| `site-manifest.json` | `bd8f9a734fd9c57c20e8575dfd4a48e082e0e7753a8e290471606f7c7a9c9ed9` |

## 確認（2026-11-21T14:53:34Z から）

| 要求 | 応答 |
|---|---|
| 公開前の `GET https://store.itonami.app/` | 404 `name-not-published` |
| `_dnslink.store.itonami.app`（権威 server、1.1.1.1） | 上の値 |
| `GET /` | 200、`text/html; charset=utf-8`、`x-ipfs-roots` = root、SHA-256 は `index.html` と一致 |
| `GET /index.html`、`/style.css`、`/logo.png`、`/site-manifest.json` | 4 件とも build の SHA-256 と一致。型は `text/html`、`text/css`、`image/png`、`application/json` |
| `HEAD /`、`PUT /ipfs/x`、`GET /nope` | 200、405、404 |
| 公開された `site-manifest.json` にある APK の URL 8 本 | 8 本とも取得でき、SHA-256 が manifest の値と一致（計 196,330,981 bytes） |
| `https://tsukuru.itonami.app/`、`https://yataverse.com/health` | 200、200（変化なし） |
| Chrome での表示 | 幅 606、暗い配色で、見出し・注意書き・入手のしかたが表示された |

テスト: `node --test store/site/build.test.mjs` は 11 件 pass。

## 確認していないこと

- Android の実機で、このページから APK を取得して入れること。
- Chrome 以外のブラウザ、読み上げ、キーボード操作。
- node からの配信（同じ root の pin）。
- root を `ipfs add` と照合すること（packer の照合は yataverse の `docs/unixfs-kubo-comparison-2026-11-21.md`）。

## 知っておくこと

- **開発版。** カタログと大半の APK は Android の debug 鍵で署名されている。ページにもそう書いてある。本番の署名鍵は無い（AWAI-2982、AWAI-3732）。
- **期限。** pointer は 2026-12-21 に切れる。ページ自体は切れたあとも配信され続けるので、新しい pointer が出るたびに build し直して公開し直す。自動化は無い。
- **更新の反映。** 名前の面は DNSLink を 60 秒、応答を 300 秒 cache する。レコードを変えても数分は古い内容が返ることがある。
- **取り下げ。** TXT レコードを消すと、host は `404 name-not-published` に戻る。block は残るが、参照されなくなる。
- **APK の配信元。** リンク先は commit を固定した `raw.githubusercontent.com` の URL で、`store.itonami.app` からは配っていない。
- **`itonami.cloud` からの導線。** 未着手。配信元の repo が特定できていない。
