# Store on the development key list: emulator record (AWAI-3775 step 4)

Date: 2026-11-22. Emulator: AOSP API 33 (`Awai_Store_AWAI3653_API33`, WebView 101). Host heavily loaded
(load average about 135); error dialogs hidden (`settings put global hide_error_dialogs 1`).

Development keys (RSA 3072, private keys in `~/.android/awai-store-dev/`, never in the repository):
root `c3ad794d…`, catalog `82522d92…`, pointer `8250a122…`. List sequence 1, issued 1795286328, expires 1810838328.
Catalog r110 (`store/distribution/dev-20261122-r110/`, #406, `60c5e04`) signed by the catalog key; pointer
sequence 4 signed by the pointer key; pins at `60c5e04`, all nine URLs fetched with exact size and SHA-256.

Builds (local, debug APK signer):

| APK | Build | SHA-256 |
|---|---|---|
| new Store, bundled catalog revision 110 | `build.py --version 1 --skip-cljs --online-pins android/online-pins.dev.json --catalog-revision 110` | `ea58e82f…` |
| new Store, bundled revision 1 (negative control) | same, `--store-only`, no `--catalog-revision` | `e68a75bf…` |
| old Store (single debug key), main `9cbd37c2` | `--store-only --online-pins android/online-pins.dev.json` | `1e511fd0…` |

| Check | Result |
|---|---|
| `build-v1.json` `trust` | `key-list`, sequence 1, root `c3ad794d…`, catalogKey `82522d92…`, pointerKeys [`8250a122…`] |
| Store APK assets | `store-root.der`, `keys.txt`, `keys.sig`; no `catalog-key.der`; page gets `window.ItonamiKeyList`, no `ItonamiPublicKey` |
| `StoreInstrumentation` | 96 assertions passed (bundled list, role separation, refusals) |
| Migration: old Store with r109 admitted (`highest` 109), then `adb install -r` new Store | `pm list packages -3` identical before and after (`pm-list-*.txt`); old `raw` dropped, `highest` 109 kept; bundled r110 shown; `keyList()` has the root (`mig-new.png`) |
| Online check on the new Store → Allow | 「署名済みオンラインカタログを確認しました。」; r110 from `60c5e04` admitted, `highest` 110 (`dev-allow.png`) |
| Admitted r110 after force-stop and restart, and after installing a different build | still `raw64`, revision 110, `catalogOnline` true |
| Negative: bundled revision 1 over `highest` 109 with no valid saved catalog | 「追加を停止しました」, catalog `{}` (`mig-rev1.png`); reinstalling the revision-110 build recovers |
| Bug found and fixed here | SharedPreferences' XML added indentation after a stored raw catalog ending in a newline (8,483 → 8,487 bytes), so the signature failed after the file was re-read. The catalog is now stored as base64 (`raw64`) |

Not checked here: the daily automatic update against the published `main` files (needs this PR merged; checked
after merge, see the AWAI-3775 comment), a physical device (moto g05: `docs/otehon/itonami-store-key-list-moto-g05-20261122.md`, App QA).
