# Encrypted Drive sync against yataverse.com — VM qualification 2026-11-18

Tracking: https://linear.app/kotobalabs/issue/AWAI-3128 (parent AWAI-3117).
Service: `https://yataverse.com`, Cloudflare Worker `yataverse-bytes` version
`db2edf6d-98f3-4881-b00f-7f76a9317fd9`, source network-awai/app-itonami-yataverse
`610d30c` (PR21). Storage: Backblaze B2. No authentication (owner decision
2026-11-18, AWAI-3126).

## Candidate

- Source: awai-os main `416f48f`, unmodified Drive code. Build:
  `AWAI_DRIVE_SYNC_ORIGIN=https://yataverse.com npm run build` after building
  `packages/awai-ui`, then `tauri android build --apk --target aarch64 --debug`
  (JDK21, NDK 27.0.12077973). `npm test`: 7 pass.
- Generated CSP: `connect-src https://yataverse.com ipc: http://ipc.localhost`;
  descriptor operations `upload` (PUT) and `download` (GET) under
  `/awai-drive/v1/packs/`, `each-operation` consent.
- APK (universal debug, development-signed): SHA256
  `8c69ca9c0bff6a75fc0092a7a4a7ee74cd9c1d67b04d4fd7abc89c1bf3c5b034`.
- No debug trust overlay, network security config or certificate was added;
  the app used system CAs. The endpoint-specific `tauri.conf.json` and
  `generated/core.js` produced by the build were not committed.

## VM

A new, task-owned API35 AOSP `default` ARM64 AVD (`ro.kernel.qemu=1`,
`sdk_phone64_arm64`, emulator port 5610). Other running emulators and devices
were not touched. Synthetic data only: folder `docs`, `readme.txt` (45 bytes)
and `docs/notes.md` (23 bytes), created through the Drive UI.

Taps used `adb input` (real input events), so the canonical consent dialog saw
trusted input. WebView DevTools was used read-only to locate elements and to log
network events.

## Observed

| Step | Observed outcome |
| --- | --- |
| Deny | Consent dialog showed service `awai.fs`, endpoint `https://yataverse.com`, `PUT /awai-drive/v1/packs/<id>`, data categories. Deny closed it; "original file has not been changed"; the Worker's live log showed no `/awai-drive` request |
| First allowed sync | Failed with `net::ERR_NAME_NOT_RESOLVED`: the emulator's default DNS relay could not resolve through this Mac's DNS setup. Not a Drive or service defect. The emulator was restarted with `-dns-server 1.1.1.1,8.8.8.8`; the file inventory was unchanged across the restart |
| Sync | Allow once (PUT) -> preflight 204 -> PUT 200 receipt -> separate Allow once (GET) -> GET 200 readback. UI: "Encrypted sync complete · Available offline" |
| Stored pack | Independent GET of pack `b327551a…7320`: 12,494 bytes, SHA256 equals the id. No file name or file content appears in plaintext in the pack |
| Evict | "Free up space" confirmation -> 0 files left in `files/drive-local-v1` |
| Restore | Allow once (GET) -> GET 200 -> "Files restored". Directories, paths, sizes and SHA256 of both files identical to the pre-sync inventory |

Pre-sync and post-restore inventory (`run-as`, outside the app):

```
D .
D ./docs
F ./docs/notes.md 23 92162087954c9083233e831db1e1b537bcf60bcf6105809dbd3e7a7250120ace
F ./readme.txt 45 074d9d4a15aa1782cb77aa86439fed00193842ea1129fbe62c1a5beaab225768
```

## Not covered

- Physical devices (the 6600H install remains held by the owner), production
  signing and release APKs.
- Fault cases already covered against the loopback fixture (upload failure,
  missing/corrupt/truncated GET, offline restore, interrupted writes) were not
  repeated against yataverse.com.
- Independent-node retention, quota/rate limits and authenticated storage.
  Anyone can store or fetch opaque packs by id on this service.
- Device-key loss recovery, Passkey/owner enrollment, hardware-backed Keystore.

APK, screenshots, inventories, CDP and Worker logs remain in the task's
`.agent-output/drive-yataverse/` (not committed).
