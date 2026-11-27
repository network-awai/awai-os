# moto g05 の Store を鍵の一覧の版に作り直す手順（AWAI-3653、AWAI-3775、AWAI-3184）

対象: owner の moto g05 に入っている Itonami Store（`network.awai.store`）。
作業者: App QA（実機の操作は App QA が行う。この文書の作者は実機に触れていない）。
目的: 入っている app をすべて残したまま、Store を現在の `main` の鍵の一覧（`AWAI-3775` sequence 2 / `r114` / pointer sequence 5 / `PR #532`）対応版に更新し、`AWAI-3184` と `AWAI-3653` の実機確認に進める状態にする。
更新履歴: 初版 2026-11-22（sequence 1 / `r110`）。2026-11-28 に `AWAI-3775` sequence 2 再ルート・`r114`・pointer sequence 5・`PR #532`（`main >= 927cd3c2`）に合わせて現行手順を更新（末尾の 2026-11-22 emulator 予行記録は履歴として保持）。

## 前提と方針

- **`main >= 927cd3c2`（`PR #532`、`AWAI-3729`）が必須。** `HostActivity` / `OnlinePins` / `online.js` の pin 上限を 64 APK / 32 KiB に揃えた版でないと、17 APK を含む `android/online-pins.dev.json` の読み込みが拒否される。
- **`AWAI-3775` sequence 2 再ルート（2026-11-23、`store/keys/README.md`）:** 現在の `main` は開発用 root `8707b4bb…`（`store/keys/store-root.der`）を固定し、鍵の一覧 `sequence 2`（`store/latest/keys-envelope.json`、有効期限 `2027-05-22`、カタログ鍵 `73e8cf0d…`、pointer 鍵 `c1587368…`）を使う。公開済みカタログは `r114`（17 APK、`store/distribution/dev-20261123-r114/catalog-rev114-raw.json`、有効期限 `2026-12-23`）、公開済み pointer は `sequence 5`（`store/latest/pointer-envelope.json`、`r114` を指す、有効期限 `2026-12-23`）。
- **旧版 Store への影響:** 鍵の一覧導入前の debug 鍵 1 本で検証する旧形式の Store だけでなく、廃止済み sequence 1 開発用 root（`c3ad794d…`）と廃止済みカタログ鍵（`82522d92…`）・廃止済み pointer 鍵（`8250a122…`）を固定していた build も、sequence 2 の鍵一覧を `keys-signature` で拒否するため、`r114` と pointer `sequence 5` を受け付けず自動更新も止まる。
- Store の APK は今も debug 鍵（`2507930b…`）で署名している。だから、同じ署名者の上書き更新（`adb install -r`）で入れ替えられ、Store のデータと、ほかの app はそのまま残る。**消すのは、どうしても必要なときの Store 本体だけ。** 端末の初期化や、ほかの app の削除はしない。
- 新しい Store は起動時に、現在の鍵一覧で検証できない保存済みのオンラインカタログ（旧形式や廃止済み鍵で署名されたもの）を捨て、同梱のカタログに戻る。巻き戻しの下限（端末が受け入れた最大の revision）は残す。**だから、同梱のカタログの revision が、端末の下限以上の build を入れる。** 下限より古いと「追加を停止しました」の画面になる（下の「失敗したとき・戻し方」）。

## 0. 用意（Mac）

1. `network-awai/awai-os` の `main`（`927cd3c2` / `PR #532` 以降）を取る。
2. 端末の下限を読む（手順 1 の `before-online.xml` の `highest`）。その値以上の revision で build する。現行公開カタログ `r114`（`--catalog-revision 114`、端末の下限が 114 を超える場合は端末の `highest` 以上）を使う。

   ```sh
   python3 android/build.py --version 1 --skip-cljs --online-pins android/online-pins.dev.json --catalog-revision 114 --out <空の directory>
   ```

   - 標準のこのコマンドが同梱カタログ（`assets/catalog.json`）に入れるのは `Yotei` と `Torihiki` の 2 件である。`--online-pins android/online-pins.dev.json` は公開オンラインカタログ（`r114`、17 APK）とその APK 取得先を固定する指定であり、初回起動時の同梱件数は 2 件のままになる。
   - 開発用のカタログ鍵（`~/.android/awai-store-dev/`）が要る。無い Mac では止まる。その場合は、鍵のある Mac で作った APK と、その SHA-256 を受け取る。
   - 報告（`build-v1.json`）の `trust` が `mode`: `key-list`、`sequence`: `2`、`root`: `8707b4bb…`、`catalogKey`: `73e8cf0d…`、`pointerKeys` に `c1587368…` を含むこと。
3. 作った `store-v1.apk` の SHA-256 と、`apksigner verify --print-certs` の署名者を記録する。署名者は、いま端末に入っている Store と同じ `2507930b…`（Android Debug）でなければならない。違うと上書きできない。

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

`before-online.xml` の `highest` が、手順 0 の build の `--catalog-revision`（既定 `114`）以下であることを確かめる。上回るなら、その値以上で build し直す。

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
| `after-store.txt` | 署名者が作業前と同じ（`2507930b…`）。`lastUpdateTime` が新しい |
| `after-online.xml`（Store を開いた直後） | `highest` は作業前と同じ値以上。検証できない旧保存カタログの `raw` / `raw64` は消え、同梱カタログに戻る |
| `after-store-keys.xml` | `highest` が `2`（鍵の一覧 `sequence 2`） |
| Store の画面（初回起動・オンライン確認前） | 「見つける」に手順 0 で同梱したカタログの app（標準ビルドでは `Yotei` と `Torihiki` の 2 件）が出る。「追加を停止しました」にならない |
| 「オンラインカタログを確認」→ 許可（`before-online.xml` の `highest <= 114` の場合） | 「署名済みオンラインカタログを確認しました。」。再取得した `after-online.xml` に `raw64` と `highest` `114` が入り、「見つける」に公開 `r114` の 17 APK（有効期限 `2026-12-23`）が出る |
| 「オンラインカタログを確認」→ 許可（`before-online.xml` の `highest > 114`、例: `115` の場合） | 公開 `r114` は `catalog-rollback` で拒否され、`after-online.xml` の `highest` は元の値のまま変わらない（負の対照）。オンラインカタログの受入確認は `revision >= highest` の署名済みカタログと対応する pin / pointer が公開されるまで保留する |
| 自動更新・日次の確認（「更新」で有効、`highest <= 114` の場合） | 次の日次の確認で、log に `keys`（より新しい鍵一覧を取った場合）と `catalog`（pointer `sequence 5`、`r114`、有効期限 `2026-12-23`）が出る |
| 自動更新・日次の確認（「更新」で有効、`highest > 114`、例: `115` の場合） | 公開 `r114` は `catalog-rollback` で拒否され（log に `error` / `catalog-rollback`）、`highest` は元の値のまま維持される。`revision >= highest` の署名済みカタログと対応する pin / pointer が公開された後に再確認する |

AWAI-3184 の Deai の確認は、このあと（`highest <= 114` で公開 `r114` を受け入れた後）Store から行う。

## 4. AWAI-3653 自動更新（常設承認）の実機確認（moto g05）

owner 承認済みの署名で適格な高 `versionCode` 更新（同一署名者・権限増加なし・Store がインストール元の app 向け）が公開されたあと、moto g05 で以下を確かめる（`r114` は `r113` と 17 APK 同一のため、実更新の確認は適格な新 `versionCode` 公開後に実施する）。

- [ ] **確認なしのサイレント更新:** 「更新」画面で自動更新（常設承認）を有効にした状態で適格更新を適用したとき、確認ダイアログを出さずに更新が完了し、次の 2 点を別々に確かめること:
  1. `shared_prefs/auto-update.xml` のログに対象 app ID の `installing`（`detail` が期待する `versionName`）と `installed`（対象 app ID。`installed` ログに `versionCode` は記録されない）が出ていること。
  2. 別途取得した端末側の対象 app の `versionCode`（`adb shell dumpsys package <対象 app ID> | grep versionCode`）が、署名済みカタログに記載された期待 `versionCode` と一致すること。
- [ ] **再起動をまたぐ永続性:** 端末を再起動しても、常設承認（`shared_prefs/auto-update.xml` の `approval`）、定期ジョブ（`JobScheduler` ID `3668`、`setPersisted(true)`）、および更新済み app の `versionCode` が維持されること。
- [ ] **自動更新 OFF 時のバックグラウンド通信ゼロ:** 「更新」画面で自動更新を OFF（取り消し）にした後、定期ジョブ `3668` がキャンセルされ（`adb shell dumpsys jobscheduler` に残らない）、バックグラウンドでのネットワーク取得リクエストが 0 件であること。

## 失敗したとき・戻し方

- **「追加を停止しました」の画面になる。** 同梱のカタログの revision が端末の下限より古い。端末の下限以上の
  `--catalog-revision` で build し直して、もう一度 `adb install -r` する。データは消えていない。
- **前の Store に戻す。** `adb install -r -d before-store.apk`（同じ署名者なので上書きでき、`-d` で versionCode が
  同じか低くても入る）。ただし、前の Store は旧形式または旧 root 固定のため、鍵一覧 `sequence 2` や pointer `sequence 5` 以降を受け付けず、自動更新は止まったままになる。新しい Store のデータ（`store-keys.xml`、`raw64`）は残るが、前の Store は読まない。
- **上書きできない（署名者の不一致など）。** 消してよいのは Store 本体だけ。消す前に owner と App QA の確認を取り、
  `before-packages.txt` と比べて、ほかの app が残っていることを確かめる。Store を消すと、Store のデータ（承認・下限・
  ログ）は消える。Store から入れた app の「インストール元」も、次に入れ直すまで Store ではなくなり、その app の
  確認なしの自動更新は、Store から入れ直すまで効かない。

## 記録の置き場所

`before-*`、`after-*` の file、build の報告（`build-v1.json`）、APK の SHA-256 を、作業した worktree の
`.agent-output/` に置き、AWAI-3653、AWAI-3184、AWAI-3775 に結果を書く。秘密鍵、パスワードは記録に入れない。

## emulator での予行（履歴: 2026-11-22、sequence 1 / r110 時点、この文書の作者）

> **履歴記録（2026-11-22）:** 以下は `AWAI-3775` sequence 2 再ルートおよび `PR #532` より前の sequence 1 / `r110` 時点に行った予行の記録であり、現行の手順ではない。

API 33 の emulator（`Awai_Store_AWAI3653_API33`）で、同じ流れを確かめた。記録は
`docs/evidence/store-key-list-dev-keys-awai3775-20261122/`。

- 旧形式の Store（main `9cbd37c2` の build）に r109 を受け入れさせ（`highest` 109）、新しい Store（r110 を同梱）を
  `adb install -r` で入れた。app の一覧は変わらず、旧形式の `raw` は捨てられ、同梱の r110 が出た。
- 負の対照: 同梱が revision 1 の build を入れると「追加を停止しました」になった。r110 の build を入れ直すと戻った。
