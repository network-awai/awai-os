# isekai: 16 KB-aligned native library — 2026-11-18

Tracking: [AWAI-3417](https://linear.app/kotobalabs/issue/AWAI-3417) (parent
[AWAI-3393](https://linear.app/kotobalabs/issue/AWAI-3393), procedure from
Hiring AWAI-3392).

Change: `apps/isekai/src-tauri/build.rs` passes `-Wl,-z,max-page-size=16384` to
the linker for an Android target only.

Build: `CARGO_BUILD_JOBS=4`, `nice -n 10 npm run build`, then
`nice -n 10 npx tauri android build --debug --apk --target aarch64`, with
`gen/android/app/build/{outputs/apk,intermediates/apk,intermediates/incremental}`
removed first. NDK 27.0.12077973, build-tools 36.1.0.

| Check | Result |
| -- | -- |
| APK | `app-universal-debug.apk`, 21,768,189 bytes, sha256 `cb835d426bfda77d5535427f554bf21e5f7912633fdf65777e34752fd6da12fe` |
| ELF | `llvm-readelf -lW lib/arm64-v8a/libisekai_lib.so`: 4 LOAD segments, all `Align 0x4000` |
| Zip | `zipalign -c -P 16 -v 4`: `lib/arm64-v8a/libisekai_lib.so (OK)`, `Verification successful` |

Not checked: no VM or device run (not requested); the warning dialog itself is
only reproducible on a 16 KB-check device such as the moto g05 (see AWAI-3393).
