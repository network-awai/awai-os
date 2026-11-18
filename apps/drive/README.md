# Awai Drive — Android Otehon app

Tauri/runtime-wry **3.0.0-alpha.6**, tauri-build **3.0.0-alpha.4**,
Android SDK37 / NDK27.0.12077973. Shared policy and encrypted snapshot orchestration
are CLJC/CLJS; Rust/Kotlin/Java expose bounded Android platform operations.
This is not Native selfhost or a signed AOSP image.

Drive supports app-private files, folders, bounded local document import,
read-only Android Files integration and explicit viewer handoff. With a
build-pinned HTTPS storage endpoint, it can encrypt using the existing Kotoba
hybrid envelope, sync an AwaiFS owner-store/CAR snapshot, retain files offline,
and restore an emptied cache using device-protected keys and a trusted root.

**Encrypted snapshots currently admit8 MiB total/1000 entries.** Ordinary local
import admits1 GiB, but larger files stay unsynced and cannot be evicted. This
is a bounded snapshot adapter, not WNFS private-tree or streamed large-file sync.
It creates a device-local recipient, not an Awai account/Passkey enrollment.
Uninstalling/clearing app data or losing device keys can make remote snapshots
unreadable. Keep original data; independent owner recovery is not implemented.
See [encryption, custody and transport boundaries](docs/encrypted-sync.md).

## Safety and integration

- Upload completion requires an explicit receipt plus separately approved full
  readback. Native admission rechecks local paths, lengths and SHA256.
- Eviction refuses unsynced changes and unpublished interrupted writes. Restore
  verifies pack/root/CIDs/owner/AEAD and every file before staged publication.
- Android Keystore protects the unlock and canonical key record in
  `noBackupFilesDir`; plaintext file cache and private control are separate.
- The exact pinned canonical browser broker requires fresh each-operation
  consent for every HTTPS PUT/GET. Denial sends no request. No native HTTP
  bypass, app-origin API, redirect or silent network fallback is introduced.
- Default builds have no storage endpoint/remote operations and hide sync
  controls. An explicit build origin derives the descriptor and static CSP.
- Android Files/pickers expose `network.awai.drive.documents` as read-only under
  `MANAGE_DOCUMENTS` and URI grants. FileProvider grants only read access to the
  local tier. External providers cannot write through either projection.
- Existing Home discovers the installed launcher through PackageManager/Awai
  Shell; no second OS setup or account authentication bypass is added.

Figma [initial states](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=257-1470)
and [sync/recovery states](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=259-1506)
reuse Android v2 buttons, color variables, cloud icon and Noto Sans JP. Existing
Core/Apps/System composition is preserved. Shared canonical consent UI remains
its owning implementation; app labels use stable JP/EN keys.

## Build and check

Run in this app with JDK21 and the Android SDK/NDK installed:

```sh
npm ci
npm run build
npm test
npm run tauri -- android build --apk --target aarch64 --debug
npm run tauri -- android build --apk --target x86_64 --debug
```

To build for an admitted storage endpoint:

```sh
AWAI_DRIVE_SYNC_ORIGIN=https://storage.example npm run build
```

The endpoint must implement the bounded immutable CAR protocol described in
[encrypted-sync.md](docs/encrypted-sync.md). This does not deploy that service.
Do not silently substitute the loopback VM fixture as a production endpoint.

`https://yataverse.com` implements this protocol (Backblaze B2 storage, no
authentication, size/hash/CAR limits). Build with
`AWAI_DRIVE_SYNC_ORIGIN=https://yataverse.com` to use it; see
[the yataverse.com section](docs/encrypted-sync.md#yataversecom) and the
[VM qualification](docs/encrypted-sync-yataverse-qualification-20261118.md).

Pure Java adapter checks, from the repository root:

```sh
javac -d .agent-output/drive-java apps/drive/src-tauri/gen/android/app/src/main/java/network/awai/drive/DriveFiles.java apps/drive/test/DriveFilesTest.java
java -cp .agent-output/drive-java DriveFilesTest .agent-output/NEW-DRIVE-TEST
```

Use a fresh test root. Preserve ABI-specific APKs and source/digest/signer
bindings. APKs are development-signed; Store size and production signing gates
remain separate. GitHub Actions is disabled and was not enabled by this task.

[Initial local-tier qualification](docs/android-qualification-20261117.md) is
historical. [Encrypted VM qualification](docs/encrypted-sync-qualification-20261117.md)
records the new evidence and handoff. Physical6600H installation is explicitly
held by the owner; no physical disks, Nix/EFI, accounts or keys were modified.

## macOS build (AWAI-3256)

The same app builds for macOS with Tauri. File operations use a bounded Rust adapter
(`src-tauri/src/desktop.rs`) with the Android `DriveFiles` rules: validated, NFC-normalised
names; paths confined to one app-private root
(`~/Library/Application Support/network.awai.drive/drive-local-v1`); symlinks refused; at most
1000 entries per folder; notes up to 64 KiB; saves published by an atomic no-clobber link.
`open` hands a file to the default viewer through `/usr/bin/open`. File import and encrypted
sync are not available on macOS yet: `pick` returns `import-unavailable`, `vaultStatus` reports
not configured, and the other vault operations return `android-adapter-required`. This app is
separate from the existing Swift AwaiDrive.app (`com.kotoba.awaivol.drive`).

```sh
(cd ../../packages/awai-ui && npm ci && npm run build)
npm ci && npm run build
(cd src-tauri && cargo test --lib)
npx tauri build --no-bundle   # binary: src-tauri/target/release/awai-drive
```
