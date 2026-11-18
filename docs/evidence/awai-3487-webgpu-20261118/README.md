# WebGPU in the Android WebView — probe results, 2026-11-18

Tracking: [AWAI-3487](https://linear.app/kotobalabs/issue/AWAI-3487) (parent [AWAI-3356](https://linear.app/kotobalabs/issue/AWAI-3356)).
Probe: [`tests/android-webgpu-probe`](../../../tests/android-webgpu-probe). Each run installed a debug APK
(`adb install -r`), launched it and read the `WEBGPU_PROBE_RESULT` line from logcat.
The debug APKs are test artifacts, not signed or OTA releases.

| Device | OS build | GPU | WebView | Result |
| --- | --- | --- | --- | --- |
| moto g05 (phone) | LineageOS 24.0 nightly, Android 17 / API 37 (not an Awai-signed build) | Mali, adapter `arm` / `bifrost` | com.android.webview 156.0.8078.47 | **ok**: compute 256/256, offscreen render centre red / corner blue, no validation errors |
| Awai Android x86_64 PC | Lineage 24.0 unofficial `awai-android-2992`, Android 17 / API 37 | Radeon (Mesa EGL); no `android.hardware.vulkan.*` feature declared | app.vanadium.webview 155.0.8059.84.0 | **unavailable**: `navigator.gpu` present, `requestAdapter()` returned null |
| Android SDK emulator arm64 | API 35 (`sdk_phone64_arm64`) | emulator | com.android.webview 124.0.6367.219 | **unavailable**: `requestAdapter()` returned null |

Positive control on the build Mac (Chromium 156 in the desktop app's browser pane, Apple Metal):
`ok`, compute and render both correct.

## Reading

- WebGPU works in the Tauri v3 Android WebView on a phone with a Vulkan-capable Mali GPU and a current WebView.
- The Awai Android x86_64 PC build does not expose WebGPU. The device declares no Vulkan
  feature flags; Chromium's Android WebGPU needs Vulkan, so this is the likely cause. Not verified:
  whether enabling a Vulkan driver (for example Mesa RADV) in the image changes the result.
- The SDK emulator does not expose WebGPU, so emulator runs cannot qualify kami 3D apps.
- The phone was locked with a credential during its run, so no screenshot of the rendered
  frame exists; the result comes from the offscreen readback check, not the visible canvas.

APK digests (sha256): arm64 `a631513341a1ea21e59a667df047c402a7f8e41b5d59a866ed306354343f2e41`,
x86_64 `6bfcdeb937e9f921fb310c02cc2f0c668f9aa22aae0f75e40ef5e9fd0a3570f1` (not committed).
