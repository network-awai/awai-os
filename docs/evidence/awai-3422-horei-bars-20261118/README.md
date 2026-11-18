# horei: system bars follow light/dark — 2026-11-18

Tracking: [AWAI-3422](https://linear.app/kotobalabs/issue/AWAI-3422) (parent
[AWAI-3393](https://linear.app/kotobalabs/issue/AWAI-3393), step 2).

## Before (main f95a2c2)

`MainActivity` already turned system bars, display cutout and IME into content
padding, but fixed light-mode (dark) bar icons and set no decor colour or
`onConfigurationChanged` handler, so dark mode had no matching bars.

## Change

`applySystemBarAppearance`, the same as `apps/payment-drafts` and
`apps/securities-drafts` (byte-identical apart from the package name): decor
`#FFFFFF` / `#14110F` (the page's `--bg`), light or dark bar icons,
`isNavigationBarContrastEnforced=false` on API 29+, called from `onCreate` and
`onConfigurationChanged` (`uiMode` is in the manifest's `configChanges`).

## Check

Clean debug APK (`CARGO_BUILD_JOBS=4 nice -n 10`): 22,763,296 bytes, sha256
`28bff19b13388b70462c9be737c84a50576b05786ee8e75942608ac7695ce068`; LOAD
segments `Align 0x4000`, `zipalign -c -P 16` OK.

Disposable AVD (`sdk_phone64_arm64`, Android 15 `AE3A.240806.019`, new with
`-wipe-data`, deleted afterwards), booted at load ~34:

| Screen | Result |
| -- | -- |
| Light (`light.png`) | Content starts below the status bar and ends above the navigation bar; dark icons on white |
| Dark, live switch (`dark.png`) | Same layout; light icons on `#14110F` |
| Dark, cold start | Pixel-identical to the live switch (sha256 `c89a0d15…febf`) |
| Light, live switch back | Pixel-identical to the first light screen (sha256 `f7781b92…db45`) |

No `FATAL` in logcat. Not checked: a physical device, the IME inset (no text
entry was opened), and the screen before the change (no before-build was made).
