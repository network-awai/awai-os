# Itonami Tauri v3 APK — 実機証跡 2026-11-16

対象: `itonami.apk`（本ディレクトリ。bytes 32644749、sha256 `09e92086…da5cb`）。
取得: `apps/itonami`（Tauri 3.0.0-alpha.6 / build 3.0.0-alpha.4 / CLI 3.0.0-alpha.6、
v2 fallback なし）から `tauri android build --apk --target x86_64 --debug`。
2026-11-16 再ビルド（`withGlobalTauri` false、provenance guards 付き `build.mjs`）。
shell は同日同ツリーから `OTEHON_HTTP=1 node build.mjs` で再ビルド。

## APK identity（aapt）

- package `network.itonami.app`、versionCode 1000、versionName 0.1.0
- platform Android 17 / API 37、minSdk 35、label `Itonami`
- permission: `INTERNET` のみ（+ 動的レシーバ用 internal）

## 実機 install / launch（10.77.0.2:5555、MQ、x86_64、Android 17）

- `adb install -r`: Success（既存 Home・Store・Yotei に影響なし、別アプリ ID）。
- `monkey -p network.itonami.app`: ResumedActivity `network.itonami.app/.MainActivity`、
  `mFocusedApp` 一致を確認。
- `launch-ui-20261116.png`: WebView が NixOS shell の Hello / Get Started 画面を描画。
  起動直後の 2 枚が黒だったのは合成タイミング（再取得で描画確認。display ON・Awake）。
- BACK キーで SetupWizard に戻ることを確認（入力経路は有効）。
  Get Started タップでの画面遷移は未確認（同梱 UI の範囲外・設置者の次工程）。
- 再ビルド版（`withGlobalTauri` false）も同 landing を描画。Soshiki 側の
  Meiji/desktop 切替は landing 以降の導線で発現するため、到達導線の確認は別工程。
  設定変更の効果はコード追跡で確認（`available?` は `__TAURI__` 不在で false→fleet 表示）。
