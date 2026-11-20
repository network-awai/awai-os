# Horei — full-text cache on Awai FS (AWAI-3324, 2026-11-18)

Record only; do not rewrite. Owner decision 2026-11-18 (chat): the device cache must use Awai FS, not IndexedDB.

## Checks run

| Check | Result |
|---|---|
| `cargo test --lib` (host, macOS) | 4 pass: CID ↔ recorded sha256, invalid/non-raw CIDs refused, put/get round trip with no `.pending` left, mismatched put writes nothing, damaged stored block deleted and reported absent |
| `npm test` | 24 pass, including the host-command contract (raw bytes plus `x-awai-cid`; an empty body means absent) |
| `npm run build` | 23 pinned files; CSP `connect-src` is `ipc: http://ipc.localhost https://yataverse.com`, derived from the descriptor with app origin `https://tauri.localhost` |
| Publish one text | `yataverse put` (network-awai/app-itonami-yataverse) of 失火責任法 `132AC1000000040`, 1,931 bytes → `bafkreihset5nn4ixabqbtdkxur6suapswdub44y2ueirb3si33i6muhunu`, `verified: true`, signed receipt; a GET read it back with sha256 `f224fad6…0f46d` |
| CORS on yataverse.com | `GET /ipfs/<cid>` with `Origin: https://tauri.localhost` or `http://tauri.localhost`: 200 with no `Access-Control-Allow-Origin`. The allow-list change (`288a8be`, AWAI-3274) is on main but not deployed (AWAI-3325) |

## Not run

- The Android APK build and emulator run. `forest-storage` refused the build with "Free-space admission floor reached" (35 GiB free against a 40 GiB floor). This task's regenerable output is about 4.4 GiB, which would not lift the floor.
- A successful fetch inside the WebView, which needs the Worker deploy.
