# Yotei — independent Otehon application

One browser UI, Awai Shell host v1 and the existing compiled `.cljc` event core, built as static Web files or a Tauri **3.0.0-alpha.6** app. The selected native engine is explicit `tauri-runtime-wry` v3 (OS WebView); there is no CEF or v2 fallback. Tauri build/macro/runtime versions are pinned in Cargo.lock and package-lock.json. No v2 or legacy Java host fallback.

## Build

```sh
npm ci
npm test
npm run build                 # dist/: immutable static files and SHA-256 manifest
npm run build:desktop         # native desktop executable, no marketplace publication
npm run build:android         # arm64 APK; installed SDK/NDK/JDK prerequisites
```

Run from `apps/yotei`. Web requires HTTPS or loopback secure context, localStorage and Web Locks. The same `dist/` is embedded by Tauri and can be delivered by static hosting. No request-time application server is needed. The event core is the pinned compiled artifact from `android/client/generated/domain.js`, built from `android/contracts/src/itonami/store/domain.cljc`; release.json records its source digest. Store screens and signed catalog are not bundled into this independent app.

NixOS: import `module.nix` and enable `programs.awai-yotei.enable`. `package.nix` builds the Linux executable from locked Rust dependencies, runs shared API/model tests, and adds a desktop entry. This initial package is opt-in and does not replace existing Awai desktop sessions. NixOS build/boot and binary-cache publication are explicitly deferred by the owner for this unit (2026-11-16). GitHub Actions is disabled on this repository; the prepared workflow has not run and no Nix closure is published.

## Android migration and rollback

Application ID remains `network.itonami.yotei`. Updating the existing APK requires the **same signer**, a higher version code, and a backup; do not uninstall/reset the old app. The Tauri WebView origin differs, so old localStorage is not implicitly visible. Before starting Tauri, MainActivity copies the old agenda projection into a one-time app-private snapshot. A native plugin reads that snapshot; the shared UI validates and asks before merging it. The old WebView storage is left in place. This is not qualified migration until an actual update/data-retention test passes.

The signature-protected `network.itonami.yotei.agenda` provider remains compatible with Awai Home. The native plugin validates bounded event data before projection. Production signing is not configured; the existing debug identity may be used only for an explicit development update. No INTERNET permission is requested by the Android app. Notifications, sync and remote inference are not implemented.

## Delivery and qualification

Static Web artifacts, native APK and Nix closure are distinct artifacts/identities. SHA-256 manifests detect byte drift; they do not authenticate a publisher. Production signing, trusted publisher metadata, immutable hosting/binary-cache URLs and Itonami Store enrollment remain explicit release work. Never mark a target qualified from another target's success.

Tracking: AWAI-2989; source base 232e3a3 from AWAI-2977, separate task worktree and branch. Source/build/Web/device/NixOS/publication evidence are recorded independently in Linear and local .agent-output logs.

## Development delivery

`node scripts/package.mjs --out <new-output-dir>` verifies the static manifest and creates a Web archive plus delivery metadata. Add `--apk <apk-path>` with `ANDROID_HOME` set to verify package identity/version and APK signature before including it. `sourceDirty` stays explicit; production publisher signing is not implied. Never distribute a dirty or unqualified artifact as a production release.

Android build prerequisite: installed JDK21, SDK37 / NDK27.0.12077973. The project disables Gradle VFS watching and persistent daemons to avoid enumerating unrelated mounted filesystems during a finite build. It does not disable runtime isolation, TLS or artifact verification. Existing caches are preserved when isolating a stalled build.
