# yotei: 16 KB alignment and system bars that follow light/dark — 2026-11-18

Tracking: [AWAI-3435](https://linear.app/kotobalabs/issue/AWAI-3435) (parent
[AWAI-3393](https://linear.app/kotobalabs/issue/AWAI-3393), steps 1 and 2).

## Change

- `src-tauri/build.rs`: `-Wl,-z,max-page-size=16384` for an Android target only.
- `MainActivity.kt`: the content already took system bars, cutout and IME as
  padding. Added `applySystemBarAppearance` (decor #FFFFFF / #14110F, light or
  dark bar icons, `isNavigationBarContrastEnforced=false` on API 29+), called
  from `onCreate` and `onConfigurationChanged` (`uiMode` is in `configChanges`).
  The page uses `--bg` #fff / #14110f (`src/style.css`). The legacy agenda capture at the start of `onCreate` is unchanged.

## Checks

Clean debug APK under the shared AWAI-3393 build lock (`CARGO_BUILD_JOBS=4 nice -n 10`),
21,796,974 bytes, sha256 `fc12c94a62a20fcaf5cd5cb5b90d48b13605ba5549040c83ef72405b15b01748`.

| Check | Result |
| -- | -- |
| ELF | `llvm-readelf -lW lib/arm64-v8a/libyotei_lib.so`: 4 LOAD segments, all `Align 0x4000` |
| Zip | `zipalign -c -P 16 -v 4`: `libyotei_lib.so (OK)`, `Verification successful` |
| VM light (`light.png`) | Content between the status and navigation bars; dark icons on white |
| VM dark, live switch (`dark.png`) | Same layout; light icons on #14110F |
| Cold start in dark, switch back to light | Dark after a live switch and after a cold start are pixel-identical; light before and after are pixel-identical. |

VM: disposable AVD, Android 15 `AE3A.240806.019` (`sdk_phone64_arm64`),
`-wipe-data`, deleted afterwards. No `FATAL EXCEPTION` in logcat.
Not checked: a physical device, the IME inset (no text field was opened).
