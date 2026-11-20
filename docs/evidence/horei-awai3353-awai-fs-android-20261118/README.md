# Horei — Awai FS put on Android (AWAI-3353, 2026-11-18)

Record only; do not rewrite. Parent: AWAI-3329 (the device acceptance of AWAI-3324). This is the same problem found in Data Contributions (AWAI-3209, PR #245).

## Problem

Horei's `awai_fs_put` accepted only `InvokeBody::Raw`. On Android, the Tauri v3 IPC (3.0.0-alpha.6) delivers the `Uint8Array` that `fulltext.js` `awaiFsCache.put` sends as a JSON array, not as a raw body. So on Android:

- every put is refused with `raw-body-required`;
- no verified full text is ever kept in Awai FS.

AWAI-3324 recorded that its Android run did not happen (no free space at the time), so this had not been seen.

## How it was checked

The Awai FS host commands were called directly from the WebView, through the DevTools socket. `horei-fs-check.mjs` calls them exactly as `awaiFsCache` does, with the fixture block `test/fixtures/132AC1000000040.json`:

- 失火責任法;
- 1,931 bytes;
- sha256 `f224fad6…0f46d`;
- CID `bafkreihset5nn4ixabqbtdkxur6suapswdub44y2ueirb3si33i6muhunu`.

This avoids the consented fetch from yataverse.com, because approving that request is the user's decision. The full flow (Allow → fetch → cache → offline reload) stays with AWAI-3329.

**Device.** AVD `Awai_Horei_AWAI3353`, created for this run from the `Awai_Drafts_AWAI3285` configuration with 2 cores and 3 GiB RAM.

- Started with `-wipe-data -no-snapshot -no-window` on port 5732. Build in `build.txt`: API 35 `sdk_phone64_arm64` userdebug.
- It was stopped afterwards (`emulator-stopped.txt`).
- Both APKs were built from awai-os `3f442d2` with `npx tauri android build --debug --apk --target aarch64`.

## Results

| Run | APK sha256 | Result | Files |
|---|---|---|---|
| Before (main `3f442d2`) | `27cb58e4…40f94` | Cold start 1,951 ms. `awai_fs_put` → **`raw-body-required`**. `awai_fs_get` returns an `ArrayBuffer` of 0 bytes. No `awai-fs` directory was created | `before-*.txt`, `before-check.json` |
| After (this change) | `dfab21fc…83562` | After `pm clear`: cold start 1,627 ms. `awai_fs_put` → ok. `awai_fs_get` returns 1,931 bytes with sha256 `f224fad6…0f46d`. The block file, read back with `run-as`, has the same sha256 | `after-check.json`, `after-store.txt`, `after-store-sha256.txt`, `after-launch.png` |
| After: mismatched bytes | | A put of 3 other bytes under that CID → **`mismatch`**. The stored block is unchanged (sha256 checked again) | `after-mismatch.json`, `after-store-sha256.txt` |
| After: restart | | After `am force-stop` and a relaunch (1,206 ms), `awai_fs_get` still returns the same 1,931 bytes and sha256 | `after-restart-get.json` |

No ANR on either run.

## Source checks

| Check | Result |
|---|---|
| `npm test` | 24 pass (unchanged; the JS still sends a `Uint8Array`) |
| `npm run build` | 23 pinned files |
| `cargo test --lib` (desktop) | 5 pass, including the new `raw_and_json_byte_bodies_are_accepted_others_refused` |

## Not done

- The consented fetch, the cache after approval, and the airplane-mode re-display. These need the user's approval in the dialog and the yataverse.com CORS deploy (AWAI-3325); they belong to AWAI-3329.
- Physical devices.
