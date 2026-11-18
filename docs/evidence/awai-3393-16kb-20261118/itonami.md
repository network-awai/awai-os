# itonami: 16 KB-aligned native library — 2026-11-18

Tracking: [AWAI-3433](https://linear.app/kotobalabs/issue/AWAI-3433) (parent
[AWAI-3393](https://linear.app/kotobalabs/issue/AWAI-3393), procedure from
Hiring AWAI-3392).

Change: `apps/itonami/src-tauri/build.rs` passes `-Wl,-z,max-page-size=16384`
to the linker for an Android target only.

Build: `CARGO_BUILD_JOBS=4`, `nice -n 10 npm run build` (owning shell CLJS/Garden
build, then packaging), then
`nice -n 10 npx tauri android build --debug --apk --target aarch64`, with
`gen/android/app/build/{outputs/apk,intermediates/apk,intermediates/incremental}`
removed first, under the shared AWAI-3393 build lock. NDK 27.0.12077973,
build-tools 36.1.0.

| Check | Result |
| -- | -- |
| APK | `app-universal-debug.apk`, 62,879,961 bytes, sha256 `f1f04d120259a740c68bae0c466e9527d34fe4677124cc37a77da9e67234e8f9` |
| ELF | `llvm-readelf -lW`: every LOAD segment `Align 0x4000` in `libitonami_app_lib.so` (4), `libonnxruntime.so` (4), `libsherpa-onnx-c-api.so` (3), `libsherpa-onnx-cxx-api.so` (3), `libsherpa-onnx-jni.so` (3). The sherpa-onnx/onnxruntime prebuilts were already 16 KB aligned; only the app library is changed by this fix |
| Zip | `zipalign -c -P 16 -v 4`: all five `lib/arm64-v8a/*.so (OK)`, `Verification successful` |

Not checked: no VM or device run. System-bar appearance (AWAI-3393 step 2) is
not part of this change: the shell chooses its theme in the app (dark default,
Asa, Hiru), not from the system light/dark setting.
