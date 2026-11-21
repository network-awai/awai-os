# Store の `minSdkVersion` の下限（2026-11-22、AWAI-3762）

親: AWAI-3732。`minSdkVersion` はいま 35（Android 15）で、理由の記録が無い（`android/build.py:38`）。
Store の Java が実際に参照する API から、下げられる下限を求めた。`minSdkVersion` の値は変えていない。

## 結論

- Store（`network.awai.store`）の Java が参照する Android API で、いちばん新しいものは **API 33（Android 13）**。34 や 35 で入った API は使っていない。
- だから、この測定の範囲では、code を変えずに `minSdkVersion` を 33 まで下げられる。
- 33 より下げるには、下の表の箇所に API level の分岐を入れる必要がある。
- これは class の参照を数えた結果で、33 や 34 の端末で動くことの確認ではない。実機と emulator での確認は AWAI-3765。

下げるかどうか、どこまで下げるかは owner の判断。

## 測定

```sh
python3 android/min-sdk-floor.py                 # Store。結果を JSON で出す
python3 android/min-sdk-floor.py --kind home     # home、yotei、torihiki も同じ
python3 android/min-sdk-floor.py --max 35        # 35 より新しい API を参照していたら exit 1
```

`android/shared/src` と `android/<kind>/src` を platform の `android.jar` に対して compile し、class file にある
method・field・class の参照を `javap` で読み、SDK の `api-versions.xml` で導入 level を引く。APK は作らない。

| 入力 | 版 |
|---|---|
| source | `network-awai/awai-os` main `bd6a2c06`、Java 12 ファイル（shared 11、store 1） |
| `android.jar` | platform `android-37.0` revision 2、SHA-256 `bf1b4387…2053f177` |
| `api-versions.xml` | 同 platform、SHA-256 `9fd47aaa…41e6c8e5` |
| JDK | OpenJDK 27.0.1（`javac --release 8`、build と同じ指定） |
| Python | 3.15.0 |

結果: 参照 527 件。level ごとの件数は 33: 3、31: 1、30: 12、29: 9、28: 5、26: 12、24: 3、23 以下: 482。
`android-35` の `api-versions.xml` で引いても同じ下限（33）になった。
`--max 32` は 3 件を挙げて exit 1、`--max 33` と `--max 35` は exit 0（負の対照）。
home、yotei、torihiki も下限は 33 で、34 以上の参照は無い。

## 下限を決めている API

| 導入 | API | 使っている場所 | 下げるときの対処 |
|---|---|---|---|
| 33 | `Intent.getParcelableExtra(String, Class)` | `InstallReceiver.java:31` | 32 以下では旧来の `getParcelableExtra(String)` に分岐 |
| 33 | `OnBackInvokedDispatcher.registerOnBackInvokedCallback` | `HostActivity.java:114` | 32 以下では `onBackPressed` に分岐 |
| 31 | `PackageInstaller.SessionParams.setRequireUserAction` | `HostActivity.java:338`、`AutoInstall.java:124` | 30 以下では呼ばない。利用者の確認なしの更新は Android 12 以降の機能なので、30 以下では毎回確認になる |
| 30 | `PackageManager.getInstallSourceInfo`、`InstallSourceInfo` | `AutoInstall.java:63` | 29 以下では `getInstallerPackageName` |
| 30 | `Window.setDecorFitsSystemWindows`、`getInsetsController`、`WindowInsets.getInsets`、`WindowInsets.Type`、`WindowInsetsController` | `HostActivity.java:50`、`:53` ほか | 29 以下では旧来の system UI flag と inset の取り方 |
| 29 | `RoleManager`、`android.graphics.Insets` | `HostActivity.java:203`、`:216` | 28 以下では role の要求を出さない |
| 28 | `PackageInfo.signingInfo`、`SigningInfo`、`getLongVersionCode` | `Catalog.java:239-248`、`AutoInstall.java` ほか | 署名者の照合の中心。27 以下は旧来の `signatures` になり、検証の強さが変わるので勧めない |
| 26 | `NotificationChannel`、`canRequestPackageInstalls`、`WebView.getCurrentWebViewPackage`、`java.util.Base64` | `AutoUpdater.java`、`HostActivity.java:85`、`:322`、`LatestPointer.java:58` | Google の開発者確認の対象も API 26 以上 |

`java/lang/invoke/LambdaMetafactory` の 2 件は `api-versions.xml` に無い。lambda の compile で出る参照で、
build の `d8` が置き換える。`MethodHandles`（26）も同じ由来。

## この測定に入らないもの

| 項目 | 状態 |
|---|---|
| manifest の permission | `UPDATE_PACKAGES_WITHOUT_USER_ACTION` は Android 12（31）から、`POST_NOTIFICATIONS` は 13（33）から。古い端末では無視される。挙動の確認はしていない |
| manifest の属性 | `enableOnBackInvokedCallback`（33）。古い端末では無視される |
| theme | splash screen の属性（31）は Home だけが使う |
| `targetSdkVersion=37` | 変えない。古い端末での互換の挙動は確認していない |
| WebView の中身 | CSS は `@layer`、nesting、`dvh`、logical property、JS は `crypto.subtle`、`<dialog>` を使う。必要なのは Android の版ではなく WebView の版（CSS nesting は Chromium 120 以降）。認定端末では WebView は Play から更新される。古い端末で WebView が古い場合の表示は確認していない |
| 同じ API の挙動の違い | 例: PackageInstaller の確認画面、background の制限、通知。参照の数え方では分からない |
| 掲載 app | Tauri の app はそれぞれの repo で `minSdkVersion` を決める。この測定の対象外 |
| Android 15 以降の端末 | `minSdkVersion` を下げても、いま動いている端末での動作は変わらないはずだが、確認していない |

## 次の判断

1. **35 のまま。** 対応する端末は Android 15 以降だけ。変更も確認も要らない。
2. **33 か 34 に下げる。** code の変更は 1 行（`android/build.py:38`）。この Mac にある API 34 の Play つき emulator で確認できる（AWAI-3765）。
3. **33 より下げる。** 上の表の分岐と、その版ごとの確認が要る。31 より下は、確認なしの更新が使えない。
