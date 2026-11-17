# Awai Drive — Android Otehon app

Standalone Tauri **3.0.0-alpha.6** / runtime-wry **3.0.0-alpha.6**,
with tauri-build **3.0.0-alpha.4**, Android SDK37 / NDK27.0.12077973.
The shared file-view policy is CLJC (`core/awai/drive`), compiled to CLJS.
Rust/Kotlin/Java are bounded Android platform adapters. This is not Native
selfhost, a signed AOSP image, or a replacement for the existing AwaiFS engine.

Figma proposal: [AWAI-3014, six Android states](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=257-1470).
Existing Android v2 buttons, color tokens and Noto Sans JP are reused; the
approved desktop/setup baseline is unchanged. The app adds a local text-save
operation and parent-folder navigation alongside the proposed controls.

## Storage boundary

This first APK exposes an **app-private local tier**, under Android's own app
storage lifecycle. File creation, folder creation, native local document import,
read-only Android document projection, and explicit viewer handoff are supported.
The UI labels this `この端末 · AwaiFS 未接続`. It has no remote operations or
INTERNET permission and never claims uploaded, remotely verified or encrypted
AwaiFS/WNFS state. Device FBE/Keystore is Android-owned and is not qualified by
this app. Uninstall/clear-data loses local files; a RAM Live OS can lose them on
OS restart. Keep originals elsewhere until remote storage/recovery is integrated.
There is no cache-eviction, remote pin, deletion, sharing-grant or migration API.

`DriveFiles` stages at most64KiB in memory, accepts at most1GiB per file,
reserves64MiB disk, limits a directory to1000 entries and paths to16 components.
It rejects traversal, controls, symlinks, unexpected source sizes and existing
names. Imports sync staged bytes before publishing. Android rejects hard-link
publication: cooperating private-adapter writers instead acquire a per-directory
OS file lock, recheck no-clobber under that lock, and atomically rename. Kotlin
syncs directory metadata before reporting success. Unknown outcomes keep the
source; this does not qualify power-loss recovery or distributed fencing.

Android SAF authority `network.awai.drive.documents` offers a read-only view in
system Files/pickers under `MANAGE_DOCUMENTS` with per-document OS URI grants.
The separate FileProvider exposes only `drive-local-v1/` with read grants.
Neither allows external writes. File import uses the system picker and accepts
only local Android document authorities; cloud providers are not silently
adopted as network adapters. Home discovers the installed launcher activity
through the existing PackageManager/Awai Shell route, without a second setup.

The browser's descriptor has memory-only view state and zero external operations.
The exact canonical broker from owning Kotoba revision91ed14c is copied through
the existing digest-verified vendor pin; no product-local validator/consent fork
is introduced. Android file data is platform storage, not localStorage metadata.

## Build and checks

Run from this app with JDK21 and the installed Android SDK/NDK:

```sh
npm ci
npm run build
npm test
npm run tauri -- android build --apk --target aarch64 --debug
npm run tauri -- android build --apk --target x86_64 --debug
```

Keep ABI-specific APKs separately; record each source revision, SHA256 and signer.
These commands create development-signed APKs, not production release/OTA
qualification. Store enrollment has its own artifact size/signing gates; direct
ADB deployment is distinct and must not bypass Store limits.

The pure Java adapter checks run from the repository root:

```sh
javac -d .agent-output/drive-java apps/drive/src-tauri/gen/android/app/src/main/java/network/awai/drive/DriveFiles.java apps/drive/test/DriveFilesTest.java
java -cp .agent-output/drive-java DriveFilesTest .agent-output/NEW-DRIVE-TEST
```

Use a fresh test root. The test covers exact bytes/SHA, reopen, duplicate and
concurrent writers, short/faulting imports, traversal/control/symlink rejection
and size admission. JVM results are a local Otehon check; Android UI/process/OS
restarts and each physical device require separate evidence. Preserve existing
Nix disks/EFI, credentials, other emulator data and live storage volumes.
