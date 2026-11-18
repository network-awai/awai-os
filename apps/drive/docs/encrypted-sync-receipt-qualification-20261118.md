# Drive storage receipt verification — VM qualification 2026-11-18

Tracking: https://linear.app/kotobalabs/issue/AWAI-3314 (receipt format AWAI-3268).
Service: `https://yataverse.com`, Worker version `fe698a93` (app-itonami-yataverse
`9c62d1f`), receipt key epoch 1 `0xad062e68…eafc`.

## Candidate

- Source: branch `claude/awai-3314-drive-receipts` (this PR). Built with
  `AWAI_DRIVE_SYNC_ORIGIN=https://yataverse.com npm run build` (after building
  `packages/awai-ui`), then `tauri android build --apk --target aarch64 --debug`
  (JDK21, NDK 27.0.12077973). `npm test`: 16 pass.
- `sync-config.js` carries the pinned yataverse.com key set. The generated CSP is
  unchanged: `connect-src https://yataverse.com ipc: http://ipc.localhost`.
- APK (universal debug, development-signed): SHA256
  `952c8c5fb87618f54df7a4c276e984115f3b19d815ffe4e42b23fa8f2c644219`.
- Negative-control APK, identical except that `receipt-trust.json` pinned a
  random key for yataverse.com (not committed): SHA256
  `48a4f1cbe8b3f1460b9de037fe77cd6866aada107e35bdfcfe2a1bf8c2363774`.

## VM

The task-owned API35 AOSP `default` ARM64 AVD from the AWAI-3128 qualification
(emulator port 5610, `-dns-server 1.1.1.1,8.8.8.8`), with its synthetic Drive
data. Other emulators and devices were not touched. Taps used `adb input`;
WebView DevTools was used read-only to locate elements and log network events.
The host was heavily loaded by other sessions (load average 170–290), which
caused ANR dialogs and dropped keystrokes; the emulator was also shut down once
from outside this session and restarted. Neither changed the results below.

## Observed

| Step | Observed outcome |
| --- | --- |
| Pinned build, new file `rcpt.t` | "Encrypt and sync" → consent for `PUT /awai-drive/v1/packs/cb161ff6…ed98` only (no key-fetch operation) → Allow once → preflight 204, PUT 200 → receipt verified → separate consent for the readback GET → Allow once → GET 200 → "Encrypted files synced." |
| Independent check | GET of that pack: SHA256 equals its id. A replay PUT returned the stored receipt, which `generated/receipt.js` verifies against the pinned key; its `acceptedAt` is 00:59:36.991Z, the time of the app's PUT |
| Wrong pinned key | "Encrypt and sync" → consent for `PUT …/cf8a4472…bb60` → Allow once → preflight 204, PUT 200 → "The storage receipt could not be verified. Nothing was marked as synced; original files have been kept." No readback consent and no GET request were made; the storage state still refers to the earlier synced snapshot |

The correct APK was reinstalled afterwards.

## Not covered

- Physical devices, production signing and release APKs.
- Service key rotation end to end (a rotated key needs a Drive rebuild; the
  wrong-key case shows the fail-closed behaviour until then).
- Keeping the receipt in the device control record (not implemented).
- The receipt says that one gateway stored and read back the pack; it is not
  independent-node retention evidence.

APKs, screenshots, network logs and the replayed receipt remain in the task's
`.agent-output/drive-receipts/` (not committed).
