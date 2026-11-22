# moto g05 の Store を鍵の一覧の版に作り直す手順（2026-11-22、AWAI-3775、AWAI-3184 の前提）

対象: owner の moto g05 に入っている Itonami Store（`network.awai.store`）。
作業者: App QA（実機の操作は App QA が行う。この文書の作者は実機に触れていない）。
目的: 入っている app をすべて残したまま、Store を鍵の一覧（AWAI-3775）の版にする。

## 前提と方針

- いまの Store は、カタログと pointer を debug 鍵 1 本で検証する旧形式。2026-11-22 以降の pointer（sequence 4 以上）と
  カタログ r110 は、開発用の root（`c3ad794d…`）の一覧にある鍵で署名されているので、旧形式の Store は受け付けない。
  自動更新も止まる。
- Store の APK は今も debug 鍵で署名している。だから、同じ署名者の上書き更新（`adb install -r`）で入れ替えられ、
  Store のデータと、ほかの app はそのまま残る。**消すのは、どうしても必要なときの Store 本体だけ。** 端末の初期化や、
  ほかの app の削除はしない。
- 新しい Store は起動時に、旧形式の鍵で署名された保存済みのオンラインカタログを捨て、同梱のカタログに戻る。
  巻き戻しの下限（端末が受け入れた最大の revision）は残す。**だから、同梱のカタログの revision が、端末の下限以上の
  build を入れる。** 下限より古いと「追加を停止しました」の画面になる（下の「失敗したとき」）。

## 0. 用意（Mac）

1. `network-awai/awai-os` の main（AWAI-3775 の 4b の merge 以降）を取る。
2. 端末の下限を読む（手順 1 の 3）。その値以上の revision で build する。r110 以上なら、どの端末でも足りる。

   ```sh
   python3 android/build.py --version 1 --skip-cljs --online-pins android/online-pins.dev.json --catalog-revision 110 --out <空の directory>
   ```

   - 開発用のカタログ鍵（`~/.android/awai-store-dev/`）が要る。無い Mac では止まる。その場合は、鍵のある Mac で
     作った APK と、その SHA-256 を受け取る。
   - 報告（`build-v1.json`）の `trust` が `key-list`、`sequence` 1、`root` `c3ad794d…`、`catalogKey` `82522d92…` であること。
3. 作った `store-v1.apk` の SHA-256 と、`apksigner verify --print-certs` の署名者を記録する。署名者は、いま端末に
   入っている Store と同じ `2507930b…`（Android Debug）でなければならない。違うと上書きできない。

## 1. 作業前の記録（端末）

```sh
adb devices -l                                                     # moto g05 だけがつながっていること
adb shell pm list packages -3 | sort > before-packages.txt         # 入っている app の一覧
adb shell dumpsys package network.awai.store | grep -E "versionCode|signatures|lastUpdateTime" > before-store.txt
adb shell run-as network.awai.store cat shared_prefs/online.xml > before-online.xml   # 下限（highest）を読む。debuggable の build のときだけ読める
adb shell pm path network.awai.store                               # 戻すときに使う
adb pull "$(adb shell pm path network.awai.store | sed 's/package://' | tr -d '\r')" before-store.apk   # 今の Store の APK を手元に残す
shasum -a 256 before-store.apk
```

`before-online.xml` の `highest` が、手順 0 の build の revision 以下であることを確かめる。上回るなら、その値以上で build し直す。

## 2. 上書き更新

```sh
adb install -r store-v1.apk
```

- `Success` 以外（特に `INSTALL_FAILED_UPDATE_INCOMPATIBLE`、署名者の不一致）のときは、そこで止めて報告する。
  `adb uninstall` はしない。
- 成功したら Store を開く。

## 3. 作業後の記録と確認

```sh
adb shell pm list packages -3 | sort > after-packages.txt
diff before-packages.txt after-packages.txt && echo "app の一覧は変わっていない"
adb shell dumpsys package network.awai.store | grep -E "versionCode|signatures|lastUpdateTime" > after-store.txt
adb shell run-as network.awai.store cat shared_prefs/online.xml > after-online.xml
adb shell run-as network.awai.store cat shared_prefs/store-keys.xml > after-store-keys.xml
```

確かめること:

| 項目 | 期待 |
|---|---|
| `diff before-packages.txt after-packages.txt` | 差分なし |
| `after-store.txt` | 署名者が作業前と同じ。`lastUpdateTime` が新しい |
| `after-online.xml` | `highest` は作業前と同じ値。旧形式の `raw` は消えている（Store を開いた後） |
| `after-store-keys.xml` | `highest` が 1（鍵の一覧の sequence） |
| Store の画面 | 「見つける」に同梱のカタログが出る。「追加を停止しました」にならない |
| 「オンラインカタログを確認」→ 許可 | 「署名済みオンラインカタログを確認しました。」。`online.xml` に `raw64` と `highest` 110 |
| 自動更新（「更新」の画面で有効にしていた場合） | 次の日次の確認で、log に `keys`（一覧を取った場合）と `catalog`（sequence 4）が出る |

AWAI-3184 の Deai の確認は、このあと Store から行う。

## 失敗したとき・戻し方

- **「追加を停止しました」の画面になる。** 同梱のカタログの revision が端末の下限より古い。端末の下限以上の
  `--catalog-revision` で build し直して、もう一度 `adb install -r` する。データは消えていない。
- **前の Store に戻す。** `adb install -r -d before-store.apk`（同じ署名者なので上書きでき、`-d` で versionCode が
  同じか低くても入る）。ただし、前の Store は旧形式なので、sequence 4 以降の pointer を受け付けず、自動更新は止まった
  ままになる。新しい Store のデータ（`store-keys.xml`、`raw64`）は残るが、前の Store は読まない。
- **上書きできない（署名者の不一致など）。** 消してよいのは Store 本体だけ。消す前に owner と App QA の確認を取り、
  `before-packages.txt` と比べて、ほかの app が残っていることを確かめる。Store を消すと、Store のデータ（承認・下限・
  ログ）は消える。Store から入れた app の「インストール元」も、次に入れ直すまで Store ではなくなり、その app の
  確認なしの自動更新は、Store から入れ直すまで効かない。

## 記録の置き場所

`before-*`、`after-*` の file、build の報告（`build-v1.json`）、APK の SHA-256 を、作業した worktree の
`.agent-output/` に置き、AWAI-3184 と AWAI-3775 に結果を書く。秘密鍵、パスワードは記録に入れない。

## emulator での予行（2026-11-22、この文書の作者）

API 33 の emulator（`Awai_Store_AWAI3653_API33`）で、同じ流れを確かめた。記録は
`docs/evidence/store-key-list-dev-keys-awai3775-20261122/`。

- 旧形式の Store（main `9cbd37c2` の build）に r109 を受け入れさせ（`highest` 109）、新しい Store（r110 を同梱）を
  `adb install -r` で入れた。app の一覧は変わらず、旧形式の `raw` は捨てられ、同梱の r110 が出た。
- 負の対照: 同梱が revision 1 の build を入れると「追加を停止しました」になった。r110 の build を入れ直すと戻った。
