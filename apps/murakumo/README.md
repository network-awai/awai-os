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

## Model manager domain (AWAI-3240)

`contracts/src/awai/inference/manager.cljc` is the shared, integer-only domain for the model manager
(stage 3 of [AWAI-3203](https://linear.app/kotobalabs/issue/AWAI-3203)). It follows
`docs/otehon/murakumo-model-manager-20261118.md` and its Figma proposal. It covers:

- the pinned catalog (`catalog.json`): repository, revision, file, bytes, SHA-256, layers, KV heads,
  head dim and license for six official Qwen3 GGUF files, taken from the Hugging Face API on
  2026-11-18;
- the estimate (file + KV cache + 0.3 GiB) and budgets: Android 40 % of RAM; Mac two thirds of
  unified memory, rounded down to a GiB;
- fit: comfortable ≤ 80 % of the budget, tight ≤ the budget, no-fit above it, unknown without RAM;
- the recommendation: the largest comfortable model, else the largest tight one;
- `awai.murakumo.device-usage.v1` snapshots, their freshness, and the all-devices row. Unknown
  values stay null, never 0.

`browser.cljs` exports it as `window.AwaiInferenceManager` for the UI (stage 4). Nothing calls the
network, downloads a model or reads device usage yet.

```bash
bb --classpath contracts/src test/manager_cases.clj
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=contracts/src basilisp run test/manager_cases.lpy
npm run build && node --test test/manager.test.mjs   # the same cases on the compiled CLJS bundle
```

`test/manager-cases.json` holds 35 hand-written cases, including the recommendation table of the
research document. A broken expectation fails each runner. A comfortable threshold changed from
80 % to 100 % fails 6 cases.

## Model manager on Android (stage 4a, AWAI-3203)

The app now lists the pinned catalog with each model's fit on this device, from `window.AwaiInferenceManager`. It also shows the recommendation, a per-model import through the Android document picker, loading any admitted model, the loaded model, and this device's usage.

- **Admission:** files are stored as `files/models/<catalog id>.gguf`. They are admitted only when size and SHA-256 equal the catalog entry, at import and again at load. The earlier `models/qwen3.gguf` is kept as the 0.6B entry.
- **One model at a time:** loading another model releases the current one. A model that does not fit cannot be loaded.
- **Usage:** `awai.murakumo.device-usage.v1` comes from ActivityManager and StatFs.
  - Device-wide CPU is `null` (unknown): Android does not let apps read it. The app's own CPU share is shown instead.
  - GPU is `null`, because the engine runs on the CPU.
- **Errors:** the Rust bridge passes the plugin's plain refusal codes (for example `model-import-rejected`) to the page, so the UI can say why.
- **No download yet.** There is still no INTERNET permission. Downloading waits for the canonical broker extension (owner decision 2026-11-18, stage 4b).

`test/live-manager-4a.mjs` runs the real APK on an emulator this run owns. It drives the WebView through DevTools and the system picker through UI Automator. Evidence: [`docs/evidence/murakumo-manager-4a-20261118.json`](../../docs/evidence/murakumo-manager-4a-20261118.json), 16/16, with [the phone screen](../../docs/evidence/murakumo-manager-4a-20261118-phone.png).

**Differences from the Figma proposal:**

- The app renders in the shared Awai UI light theme, not the dark frames.
- The model action reads "Import from file" instead of "Download" until stage 4b.
- CPU shows this app's share, because device-wide CPU is unreadable.
