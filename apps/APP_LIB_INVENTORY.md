# System-bar library inventory (AWAI-3443)

Every Android app in awai-os uses the common library
`packages/awai-system-bars/` (design: `packages/awai-system-bars/README.md`).
Apps pass **theme (+ accent) only**; the library decides the status-bar color,
navigation-bar color, decor color and `isAppearanceLight*` icon flags. The
default is device-dark-mode follow (`uiMode`); no app locks the system theme.
The shell theme mapping (dark → dark, Asa → light, Hiru → light) lives in
`SystemBarAppearance.isLightForShellTheme`.

Gates: `python3 scripts/check-system-bars.py` (fails if direct bar-color
logic remains outside the library, or an app is not wired to it) and
`python3 packages/awai-system-bars/test/run_tests.py` (38 unit tests).

## Library

- `packages/awai-system-bars/android/network/awai/systembars/SystemBarAppearance.java`
  (pure policy: light #ffffff / dark #14110f, shell #15181c/#ffffff/#eaf7ff,
  luminance-driven icon contrast, uiMode + shell-theme + accent inputs)
- `packages/awai-system-bars/android/network/awai/systembars/SystemBars.java`
  (Android apply: the repo's only `setStatusBarColor` /
  `setNavigationBarColor` / decor / `APPEARANCE_LIGHT_*` /
  navigation-contrast writes; framework API, no AndroidX)

## Scattered state before this change (file:line, pre-migration)

The same `applySystemBarAppearance` (uiMode → `#ffffff`/`#14110f` + 
`isAppearanceLight*`) was copied into 11 Tauri `MainActivity.kt` (x402,
isekai, horei, data-contribution, payment-drafts, securities-drafts,
public-funds, soudan, yotei, murakumo, murakumo-net, and the
`tests/android-webgpu-probe` copy) and into `HostActivity.java:49-55`
(`setStatusBarColor(TRANSPARENT)` + `APPEARANCE_LIGHT_*`). `apps/itonami`
had only `enableEdgeToEdge()` defaults — no bar color at all.
`ShirohanActivity.java:46-50` handled insets only; `Sanka/MainActivity.java`
had no system-bar handling.

## Apps using the library (post-migration file:line)

All call `SystemBars.applyForUiMode(this, config)` from `onCreate` **and**
`onConfigurationChanged`, and include the library source in their build.
`AndroidManifest.xml` already carries `uiMode` in `configChanges`, so a
theme switch arrives without recreating the activity.

| App | `MainActivity` lib calls | `build.gradle.kts` srcDir |
| --- | --- | --- |
| apps/data-contribution | `MainActivity.kt:17,24` | `build.gradle.kts:29` |
| apps/horei | `MainActivity.kt:17,24` | `build.gradle.kts:29` |
| apps/isekai | `MainActivity.kt:17,24` | `build.gradle.kts:29` |
| apps/itonami | `MainActivity.kt:53,59` | `build.gradle.kts:32` |
| apps/murakumo | `MainActivity.kt:19,26` | `build.gradle.kts:29` |
| apps/murakumo-net | `MainActivity.kt:19,26` | `build.gradle.kts:28` |
| apps/payment-drafts | `MainActivity.kt:17,24` | `build.gradle.kts:29` |
| apps/public-funds | `MainActivity.kt:17,24` | `build.gradle.kts:29` |
| apps/securities-drafts | `MainActivity.kt:17,24` | `build.gradle.kts:29` |
| apps/soudan | `MainActivity.kt:17,24` | `build.gradle.kts:29` |
| apps/x402 | `MainActivity.kt:17,24` | `build.gradle.kts:29` |
| apps/yotei | `MainActivity.kt:22,29` | `build.gradle.kts:29` |
| tests/android-webgpu-probe | `MainActivity.kt:17,24` | `build.gradle.kts:29` |

Full paths: `apps/<app>/src-tauri/gen/android/app/src/main/java/.../MainActivity.kt`
(e.g. `apps/x402/src-tauri/gen/android/app/src/main/java/network/itonami/x402/MainActivity.kt`).

| Host | Lib call | Build wires the library |
| --- | --- | --- |
| `android/shared/.../HostActivity.java` (Home, Store, Yotei, Torihiki via `android/build.py`) | `:55` | `android/build.py:224` |
| `android/shirohan/.../ShirohanActivity.java` | `:46` | `android/shirohan/build.py:78-79` |
| `android/sanka/.../MainActivity.java` | `:55` | `android/sanka/build.py:36` |

Notes per app:

- **itonami** follows the device `uiMode` like every other app (owner
  decision supersedes the original "do not follow the system" draft). Its
  shell themes still map through the library (`fromShellTheme`: dark →
  dark bars, Asa/Hiru → light bars) if a future JS-to-native bridge passes
  the shell theme; today the activity has no shell-theme channel, so it
  defaults to system follow. The shell's dark `--bg` is `#15181c` vs the
  library's dark `#14110f` — a 1/255 difference, imperceptible under the
  edge-to-edge decor.
- **HostActivity**'s frame background comes from the `awai_background`
  resource (palette `#ffffff`/`#14110f`, same values as the library's
  canonical backgrounds), so lib defaults match the frame exactly.
- **murakumo / murakumo-net** keep their `enableEdgeToEdge()` call; the
  library only replaces the color/icon part of their activity.
- **tests/android-webgpu-probe** is a WebGL harness with no page `--bg`;
  it follows the system like the other apps.

## No-omission list

- `apps/dapp-carrier` — web-only dapp carrier (no Android native shell,
  no `MainActivity`); there is no bar color to apply. Nothing to migrate.
- `apps/drive` — pointer file only; canonical Android source lives in
  `network-awai/app-drive` (`tauri/src-tauri/gen/android/.../MainActivity.kt`,
  still carrying the copied `applySystemBarAppearance`). External repo:
  future work, **not edited from this worktree**.

## Future work (outside this repo, not edited here)

- `network-awai/app-drive` — adopt `packages/awai-system-bars` (vendored
  or via a shared package source) once the library is released from awai-os.
- `network-awai/app-*` (~50 repos) and the `cloud-itonami` series/cloud
  repos — many carry the same copied `applySystemBarAppearance` (confirmed
  read-only for app-drive via `gh api`). Each needs its own PR wiring
  `packages/awai-system-bars` in (or a published copy of) its build.

## Verification (this PR)

- `python3 packages/awai-system-bars/test/run_tests.py` — 38 unit tests
  (light/dark outputs, icon-contrast flip, uiMode + shell-theme mapping,
  accent override). All pass; no emulator, no device.
- `python3 scripts/check-system-bars.py` — duplication gate (negative
  control verified: injecting `setStatusBarColor` into x402 fails the gate),
  per-app wiring checks, per-app theme-match checks (page `--bg` == lib
  canonical backgrounds; palette/shell constants re-asserted).
- `javac` — modified Java hosts + library compile (`--release 8` for
  shared/sanka, `--release 11` for shirohan).
- **No emulator run.** Per task constraints, no emulator was started and
  no physical device was used; on-device (VM/physical) bar verification
  remains open. 16 KB page/alignment checks are out of scope for this PR
  (AWAI-3393) and were not claimed.
