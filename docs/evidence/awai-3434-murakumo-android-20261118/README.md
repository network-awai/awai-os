# murakumo: 16 KB alignment and system bars that follow light/dark — 2026-11-18

Tracking: [AWAI-3434](https://linear.app/kotobalabs/issue/AWAI-3434) (parent
[AWAI-3393](https://linear.app/kotobalabs/issue/AWAI-3393), steps 1 and 2).

## Change

- `src-tauri/build.rs`: `-Wl,-z,max-page-size=16384` for an Android target only.
- `MainActivity.kt`: the content already took system bars, cutout and IME as
  padding. Added `applySystemBarAppearance` (decor #FFFFFF / #14110F, light or
  dark bar icons, `isNavigationBarContrastEnforced=false` on API 29+), called
  from `onCreate` and `onConfigurationChanged` (`uiMode` is in `configChanges`).
  The page follows the system theme through the shared `awai-ui.css` (`.awai-ui`, `--awai-background` #ffffff / #14110f), which overrides `client/app.css`'s `color-scheme:dark`. A first attempt that fixed the bars to dark left dark bars over the light page in light mode; it was replaced before this PR.

## Checks

Clean debug APK under the shared AWAI-3393 build lock (`CARGO_BUILD_JOBS=4 nice -n 10`),
29,826,992 bytes, sha256 `3e70f3eb98622008eeb37f2b36c75aa44e87568ae74bfc87177343f5ce6a83fa`.

| Check | Result |
| -- | -- |
| ELF | `llvm-readelf -lW lib/arm64-v8a/libmurakumo_app_lib.so`: 4 LOAD segments, all `Align 0x4000` |
| Zip | `zipalign -c -P 16 -v 4`: `libmurakumo_app_lib.so (OK)`, `Verification successful` |
| VM light (`light.png`) | Content between the status and navigation bars; dark icons on white |
| VM dark, live switch (`dark.png`) | Same layout; light icons on #14110F |
| Cold start in dark, switch back to light | Live switch and cold start show the same layout; the screens differ only in the live RAM/CPU readings. |

VM: disposable AVD, Android 15 `AE3A.240806.019` (`sdk_phone64_arm64`),
`-wipe-data`, deleted afterwards. No `FATAL EXCEPTION` in logcat.
Not checked: a physical device, the IME inset (no text field was opened).
