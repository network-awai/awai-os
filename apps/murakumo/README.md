# Murakumo Android Otehon — AWAI-3011

A separate Tauri3.0.0-alpha.6 Android app (`network.awai.murakumo`) using explicitly pinned llama.cpp, CPU only. It does not qualify or replace the Kotoba/Amu Native Murakumo engine. Existing Nix installations and other Android devices are outside this build's mutation scope.

Figma: [model lifecycle and handoff](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=252-3), [preserved Itonami shell](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=255-58). Editable original components/tokens and Noto Sans JP; no particle redesign.

`pins.json` fixes engine revision/archive digest and the official Qwen3 0.6B Q8_0 GGUF revision/size/SHA256. The model is **not bundled or silently downloaded**. Select the exact local file through Android's document picker; failed digest/size admission leaves the old model intact. This first engine exposes text only. Image/video capabilities are explicitly unavailable; Gaka/Dougaka media generation requires its own actual backend.

## Build and check

Use installed CMake, Android NDK27.0.12077973, SDK37, JDK21 and Rust Android targets. `scripts/build-native.py` downloads only the pinned engine source, verifies it and builds shared libraries. It does not connect to devices, download models or run a host model.

```sh
python3 apps/murakumo/scripts/build-native.py arm64-v8a x86_64
npm ci --prefix apps/murakumo
npm run build --prefix apps/murakumo
npm test --prefix apps/murakumo
# Configure JAVA_HOME / ANDROID_HOME / ANDROID_NDK_HOME for this host.
npm run tauri --prefix apps/murakumo -- android build --apk --target aarch64 --debug
```

Shared `.cljc` admission is actually compiled to CLJS. The Java/Kotlin and C++ adapters independently enforce request, context/output, model digest, memory-residency and concurrency limits. One model, four CPU threads, context2048, prompt8192 UTF-8 bytes, output256 tokens, CPU abort callback/deadline90s. Model loading itself is bounded by the admitted639,446,688-byte artifact, not claimed to obey the generation deadline. Cancel produces no completed output. Release frees the model; process death requires a new explicit load.

The app has no INTERNET permission, no listening HTTP server, no remote inference or app-origin BFF. The static frontend talks only to its scoped Tauri native command. The host engine stays on the user's device. Android lifecycle/ordinary app memory behavior is not a foreground-resident-service guarantee.

## App-to-app contract

`packages/awai-inference` supplies the client and Android adapter. Consumers need its explicit native command, the signature permission and a manifest package query. The provider accepts only the named app allowlist **and** matching signature. Readiness is read-only; generation uses an explicit Activity result bound to request UUID, engine and modality. A fresh native confirmation displays the actual calling app and prompt excerpt before each generation. Denial returns no result and does not run the model. No persisted blanket grant or HTTP fallback.

Development signer is the existing Android debug identity. Production signer/allowlist rotation, independent permission-adversary APK tests, store delivery, model acquisition UX, full phone/desktop lifecycle, image/video engines and Awai FS output sync remain separate qualification work. The SDK's presence is not acceptance of every consumer app. Home enrollment, Itonami authentication and local inference are distinct; no owner identity is fabricated/copied to expose this view.

6600H is reserved by the independent AWAI-2992 persistence chat. This task stops all physical ADB/install/settings/reboot operations until that work releases the device. VM tests use only `emulator-5570`.
