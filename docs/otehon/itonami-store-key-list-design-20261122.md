# Itonami Store の署名鍵を役割ごとに分ける設計（2026-11-22、AWAI-3763 / AWAI-3774）

## 決定

owner 決定（2026-11-22、AWAI-3763 に記録）:

1. 署名鍵を役割ごとに分ける（APK、カタログ、pointer）。
2. Store が鍵を信じる方式は、**root 鍵が鍵の一覧に署名する方式**にする。

承認されたのは設計と実装。本番鍵の生成、取得、発行、移動、保管は含まない（操作ごとに owner の承認が要る）。

この文書の残りは、その決定を形にした私の設計で、owner の決定ではない。違っていれば直す。

## いまと、これから

| | いま（main） | これから |
|---|---|---|
| Store が埋めて持つ鍵 | カタログの公開鍵 1 本（`catalog-key.der`） | root の公開鍵 1 本 |
| カタログの署名 | APK と同じ debug 鍵 | カタログ鍵（一覧に載っているもの） |
| pointer の署名 | 同じ debug 鍵 | pointer 鍵（一覧に載っているもの） |
| APK の署名 | 同じ debug 鍵 | APK の署名鍵。Android が照合する。一覧には入れない（AWAI-3771） |
| 鍵を替える | Store を作り直して入れ直す | 番号の大きい一覧を出し直す |

root は一覧に署名するときだけ使う。日々のカタログと pointer の署名には使わないので、別に保管できる。

## 鍵の一覧（`itonami.store.keys.v1`）

署名する bytes は ASCII の行で、各行は LF 1 個で終わる。順序は固定。

```
itonami.store.keys.v1
sequence 3
issued 1795300000
expires 1803076000
key catalog <base64 の SubjectPublicKeyInfo>
key pointer <base64 の SubjectPublicKeyInfo>
```

- 署名は root 鍵の SHA256withRSA。いまのカタログと pointer と同じ方式。
- `key` の行は、catalog を先に、pointer を後に書く。役割ごとに 1 本以上 4 本まで。
- 鍵は RSA 2048 bit 以上。1 本の鍵は 1 つの役割にだけ載せられる。root 鍵を役割の鍵として載せることはできない。

### 検証の規則（`KeyList.verify`）

先に大きさと署名を確かめ、通ったものだけを読む。拒否は理由ごとに code が違う。

| code | 拒否するもの |
|---|---|
| `keys-size` | 空、または 16,384 bytes を超える |
| `keys-signature` | root の署名でない。root が RSA 2048 bit 以上の鍵でない |
| `keys-format` | ASCII でない、CR や tab がある、最後が LF でない、空行、行の順序や形が違う |
| `keys-schema` | 1 行目が `itonami.store.keys.v1` でない |
| `keys-number` | 数が 10 進の正の整数でない（符号、先頭の 0、指数、16 桁以上） |
| `keys-rollback` | 番号が、その host が受け入れた最大の番号より小さい |
| `keys-issued` | 発行時刻が、いまより 300 秒を超えて先 |
| `keys-expired` | 期限切れ。期限が発行より前。有効期間が 190 日を超える |
| `keys-role` | 役割が catalog と pointer 以外。catalog の行が pointer の行より後にある |
| `keys-count` | どちらかの役割に鍵が無い、または 4 本を超える |
| `keys-key` | base64 が正規の形でない。RSA の公開鍵でない。2048 bit 未満 |
| `keys-duplicate` | 同じ鍵が 2 回載っている。root 鍵が載っている |

`KeyList.authentic(role, data, signature)` は、その役割に載っている鍵のどれかが署名していれば真を返す。
カタログ鍵で署名した pointer、pointer 鍵や root 鍵で署名したカタログは、真にならない。

### 形式を JSON にしなかった理由

- 同じ内容を 1 通りの bytes でしか書けない。JSON は key の重複、数の書き方、空白で、読む側ごとに解釈が分かれうる。
- Java と JavaScript の両方で、library なしに同じ規則で読める。Android の `org.json` に依存しないので、JVM だけで test できる。

カタログと pointer の形式（JSON）は変えない。

## 更新と失効

- **替える。** 新しい鍵と古い鍵の両方を載せた一覧（番号 +1）を出す。新しい鍵で署名を始め、行き渡ったら、古い鍵を外した一覧（番号 +1）を出す。
- **失効させる。** その鍵を外した一覧を、番号を上げて出す。Store は受け入れた最大の番号を覚えているので、古い一覧には戻らない。
- **「失効した鍵」の一覧は持たない。** 載っていない鍵は使えない、という 1 つの規則で足りる。
- **root をなくす、漏らす。** 一覧では直せない。root の公開鍵は Store に埋めてあるので、新しい root の Store を配り直すことになる。root を普段使わず別に保管するのは、このため。

## 残る risk

| risk | 状態 |
|---|---|
| 入れた直後の Store は、同梱の一覧しか知らない | 古い Store の APK を新しく入れた端末は、通信で新しい一覧を取るまで、同梱の一覧に載っている鍵（その後に外されたものを含む）を信じる。期限（最長 190 日）が上限になる。Store 本体を新しく保つ経路が要る（未実装、計画 §1 の 5） |
| 通信を止められる | 新しい一覧が届かなければ、失効は伝わらない。これも一覧の期限が上限 |
| 端末の時計 | 期限の判定は端末の時計による。時計を戻せば、切れた一覧が通る。番号の巻き戻しは時計に関係なく拒否する |
| 一覧の期限切れ | 190 日以内に root で出し直さないと、Store はカタログも pointer も受け付けなくなる。運用の手順が要る（次の issue） |
| root 鍵 | 1 本だけ。root の更新の仕組みは無い |
| RSA 2048 | いまの方式を引き継いだ。別の方式（Ed25519 など）への移行は、この設計に入れていない |

## 私が決めた値（owner の決定ではない）

- 一覧の有効期間の上限: 190 日。半年ごとに出し直す想定に、余裕を足した。短くすると失効が早く伝わり、長くすると root を使う回数が減る。
- 役割ごとの鍵の上限: 4 本。更新の重なりに 2 本、予備に 2 本。
- 鍵の最小の長さ: 2048 bit。
- 時計のずれの許容: 300 秒。pointer と同じ値。

## この PR に入っているもの、いないもの

入っている:

- `android/shared/src/network/awai/platform/KeyList.java`: 形式の読み取りと検証。Android の API を使わない。まだ誰も呼ばない。
- `android/tests/jvm-keys/KeyListTest.java`、`android/tests/key-list.sh`: JVM の test、61 項目。鍵は test の中で作り、disk に書かない。

入っていない（次の issue）:

1. Store（`Catalog`、`LatestPointer`、`AutoUpdater`、`HostActivity`）が、埋めた root と一覧でカタログと pointer を検証するように切り替える。受け入れた最大の番号を保存する。
2. Web 側（`android/client/online.js` の `authenticateCatalog`）と、入口ページの build（`store/site/build.mjs`）の検証を合わせる。
3. `android/build.py` が root・カタログ・pointer の鍵を別々に受け、一覧を同梱する。一覧に署名する script と、公開する場所。
4. 更新と失効の運用手順。
5. 開発用の鍵（いまの debug 鍵）の扱い。開発 build は、開発用の root と役割の鍵で同じ仕組みを通す。

## 確認

- `bash android/tests/key-list.sh`: 61 項目 pass（OpenJDK 27.0.1、`javac --release 8`）。
- `bash android/tests/update-policy.sh`: 従来どおり pass。
- shared と Store の Java を `android.jar`（platform 37.0）に対して compile できる。`python3 android/min-sdk-floor.py --max 33` は exit 0（新しい API の参照を足していない）。

確かめていないこと: 端末での動作（まだ呼ばれていない）、JavaScript 側の実装との一致（まだ無い）。
