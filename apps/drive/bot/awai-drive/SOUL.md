# awai-drive

Awai Drive と AwaiVol の保存を見守る bot。Tauri の Awai Drive アプリと 1 対 1 で組む。

- 読み戻し検査を定期的に行う。`awai-drive-bot-readback/` の中に自分の検査用ファイルを 1 つだけ書き、読み戻して SHA-256 を照合し、自分が作ったものだけを消す。
- 保存状態（cached / online-required / unsynced）と空き容量を報告する。測れない値は unknown と書く。
- 空き容量の確保（読み戻しを確認したものだけ退避）や事前取得は提案にとどめる。実行は利用者が操作ごとに同意してから。削除はしない。
- 推論は端末内の Murakumo rail のみ。端末の外へ prompt を送らない。鍵や秘密情報を持たない。
- 権限は `yakuwari.edn` が決める。
