# Murakumo PHI 経路: 案（実装していない）

## A. 確認の画面に出す prompt の量（項目 1 の案）

今は prompt の先頭 240 文字を出している。FLAG_SECURE で Recents とスクリーンショットには残らなくなったが、横から見られること（肩越し）と、画面共有・外部ディスプレイで見える可能性は残る。

- **karute（PHI の呼び出し元）には実装した（Dev のレビュー #429）:** 長さと種類だけを出す。以下は、ほかの呼び出し元と「内容を確認」ボタンの案。
- **推奨: 既定では出さない。** dialog には「呼び出し元の app 名」「テキスト／画像」「長さ（約 N 文字）」だけを出す。「内容を確認」ボタンを押したときだけ、先頭 80 文字を出す。
- 理由: 同意の判断に要るのは「どの app が、端末内で、何を生成させるか」で、患者の記録そのものではない。karute の画面には同じ下書きがすでに出ている。
- 代案: 常に先頭 80 文字だけにする（今の 240 から短くするだけ）。作業量は 1 行。
- 影響: README の「A fresh native confirmation displays the actual calling app and prompt excerpt」の記述と、それに頼る live test（`test/live-*.mjs`）の UI Automator の照合を直す必要がある。画像の経路（Gaka など）では prompt が短く PHI でないことが多いので、modality で出し分けてもよい。

## B. INTERNET 権限を推論の uid から外す（項目 6）

### 今
`network.awai.murakumo` 1 つの uid が、(1) 推論（llama.cpp、stable-diffusion.cpp）、(2) model のダウンロード（Hugging Face への固定の GET）、(3) Mac ノードの使用量の読み取り（固定の GET）を持つ。(2)(3) のため INTERNET 権限がある。推論の経路に通信のコードがないことは、ソースのレビューと、今回入れた lint・.so の import 検査で確かめているが、OS は保証していない。

### 案
1. **推論の app（`network.awai.murakumo`）**: INTERNET を外す。`InferenceRequestActivity`、`InferenceStatusProvider`、Engine、ImageEngine、Models（admission と load）だけを持つ。Android は INTERNET がない uid の socket を EACCES で拒むので、将来のコードの変更や依存の追加でも外に出ない（OS が保証する）。
2. **管理の app（例: `network.awai.murakumo.manager`、同じ署名）**: いまの WebView UI、model のダウンロード（canonical broker と同意）、使用量の読み取り、All devices。INTERNET を持つ。PHI は通らない（karute は推論の app にだけ話す）。
3. **model ファイルの受け渡し**: 管理の app がダウンロードして SHA-256 を確かめたファイルを、推論の app に渡す。方法は、推論の app の signature 権限つき `ContentProvider` か Activity に、管理の app が `ParcelFileDescriptor` を渡し、推論の app が自分の `filesDir/models` に copy して、いまと同じく size と SHA-256 で admit し直す。推論の app は受け取る側なので、通信は要らない。document picker での import は推論の app に残してよい。
4. **Load／Release／状態の表示**: 管理の app の UI から、推論の app の signature 権限つき provider（`status`、`load`、`release`）を呼ぶ。使用量（RAM、CPU）は推論の app の provider が返す。

### 代案
- 同じ APK で `android:process` を分けても、uid は同じなので INTERNET は外れない。**効果がない。**
- `android:sharedUserId` は非推奨で、uid が同じになる。**使わない。**
- isolated process（`android:isolatedProcess="true"` の Service）で推論を動かす: isolated uid は INTERNET を持たない。1 つの APK のままで済むが、isolated process は自分の filesDir を読めないので、model を FD で渡す必要があり、JNI の engine を bound service に移す作業がいる。INTERNET を外すのと同じ OS の保証が得られる。**B 案（2 つの app）と並ぶ候補。** 作業量は 2 つの app と同程度だが、配布と署名が 1 つで済む。

### 影響
- karute などの呼び出し側: 変わらない（package 名、権限、Activity 名がそのまま）。`InferenceClientPlugin.kt` の `open` は MainActivity を開くので、管理の app を開くよう直す（1 行）。
- 端末にある model: 推論の app に残るので、移し替えは要らない（package 名を変えない場合）。
- Store とカタログ: app が 1 つ増える（管理の app）。署名の鍵の group を決める必要がある。
- テスト: `test/live-download-4b.mjs`、`live-manager-4a.mjs`、`live-devices-5.mjs`、`android/test/*` の QA の派生 build（`prepare-qa.mjs` が INTERNET を外している）を、2 つの app に合わせて直す。
- isolated process 案では、ImageModels の `cacheDir/generated` と FileProvider の扱いも変わる。

### 作業量（目安、見積もりで実測ではない）
- 管理の app の分離（Tauri の 2 つ目の app、UI の移動、provider の追加）: 中〜大。PR 2〜3 本。
- model の受け渡し（FD と admit）: 小〜中。PR 1 本。
- テストと QA の派生 build の追従: 中。PR 1〜2 本。

### 移行の順番
1. 推論の app に、FD で model を受け取る入口（signature 権限）と `load`／`release` の provider を足す。今の UI はそのまま動く。
2. 管理の app を作り、ダウンロードと使用量の読み取りをそちらに移す。両方の app を並べて配る期間を置く。
3. 推論の app の UI から通信の機能を外し、manifest から INTERNET を外す。`check-release.py --apk` に「推論の app の manifest に INTERNET がない」検査を足す（負の対照つき）。
4. karute の Legal 条件の根拠を「ソースのレビュー」から「OS の権限」に書き換える。
