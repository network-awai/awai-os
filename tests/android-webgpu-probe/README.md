# Android WebGPU probe

A Tauri v3 test app that checks whether the OS WebView on an Awai Android device
exposes WebGPU. The kami 3D apps (CAD, modeler, sculpt, suji, BIM) all need it.
Tracking: [AWAI-3487](https://linear.app/kotobalabs/issue/AWAI-3487). This is a qualification
tool, not a product app: it has no Store entry and no external operations.

The probe (`src/probe.js`) requests an adapter and a device, runs a compute shader over
256 values and compares every element, renders a triangle offscreen and reads back two
pixels, and draws the same triangle on the visible canvas. The result is:

- `ok`: adapter, compute and render all check out with no validation errors
- `unavailable`: `navigator.gpu` is missing or `requestAdapter()` returns null
- `failed`: anything throws, a value is wrong, or a validation error is reported

There is no WebGL fallback. The app logs one `WEBGPU_PROBE_RESULT {json}` line.

## Build and run

```sh
(cd ../../packages/awai-ui && npm ci && npm run build)   # shared UI, once per checkout
npm ci
npm test                       # negative controls: missing gpu, null adapter, wrong compute/pixels
npm run build
npm run build:android          # arm64 debug APK; JDK 21, SDK 37, NDK 27.0.12077973
npm run build:android:x86      # x86_64 debug APK
scripts/run-on-device.sh <adb-serial> <apk>   # install -r, launch, read the result line
```

Both Android builds write the same `app-universal-debug.apk` path; copy it before building
the other target. Results: [docs/evidence/awai-3487-webgpu-20261118](../../docs/evidence/awai-3487-webgpu-20261118).
