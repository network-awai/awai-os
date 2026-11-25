# awai-system-bars

Common Android system-bar library for every Awai OS app (AWAI-3443).

## Design (one page)

**Problem.** Every Android app decided its status/navigation bar colors and
icon contrast inline, in its own copy (`applySystemBarAppearance` in each
Tauri `MainActivity.kt`, `setStatusBarColor`/`APPEARANCE_LIGHT_*` in the
`android/` Java hosts). Twelve Tauri apps carried near-identical code with
hard-coded `#ffffff` / `#14110f`, while itonami left the bars to
`enableEdgeToEdge()` defaults — its shell themes (dark `#15181c`, Asa
`#ffffff`, Hiru `#eaf7ff`) did not match the bars at all.

**Decision.** One common library, applied to all apps. An app passes **theme
(+ accent) only — it never decides bar colors itself**. The library outputs
the status-bar color, navigation-bar color, decor color and both
`isAppearanceLight*` icon flags.

| Input | Behavior |
| --- | --- |
| Device `uiMode` | The default for every app: follow the device dark mode. No app locks or overrides the system theme, and there is no force-light/force-dark API. |
| Otehon shell theme (`dark`, `Asa`, `Hiru`, or the implicit dark default) | Mapped to light/dark: `dark`/default → dark bars, `Asa`/`Hiru` → light bars. This is the sole reconciliation of shell and system themes. |
| Accent color (optional) | When given, the bars and decor use the accent instead of the canonical page background. Icon contrast is derived from the accent's luminance, so dark icons land on light accents and light icons on dark accents with no app-side logic. |

Canonical backgrounds match every app's page `--bg` (`#ffffff` light,
`#14110f` dark, pinned in `android/contracts/.../domain.cljc`):
`LIGHT_BACKGROUND` / `DARK_BACKGROUND`. The shell backgrounds (`#15181c`,
`#ffffff`, `#eaf7ff`) are exposed as constants in `SystemBarAppearance` for
the shell-theme inputs.

**Shape.** Two files, both Java (callable from Kotlin and Java):

- `SystemBarAppearance` (pure): `fromLight` / `fromUiMode` /
  `fromShellTheme` (+ accent overloads), `luminance`, `lightIconsForBackground`.
  No Android framework references, so unit tests run on a plain JVM.
- `SystemBars` (Android): `apply`, `applyForUiMode`, `applyForShellTheme`
  (each with an accent overload). Owns the only
  `setStatusBarColor` / `setNavigationBarColor` / decor / icon-appearance /
  `setNavigationBarContrastEnforced(false)` writes in the repo. Framework
  `WindowInsetsController` (API 30+) with `systemUiVisibility` fallback below;
  no AndroidX dependency.

**Dependency direction.** `app → library`, one-way. The library knows no app;
apps depend on it by compiling its source into their own module:

- Tauri `MainActivity.kt` apps (`apps/*`): `sourceSets.java.srcDir` in
  `src-tauri/gen/android/app/build.gradle.kts`, e.g.
  `sourceSets.getByName("main").java.srcDir("../../../../../../packages/awai-system-bars/android")`,
  then `SystemBars.applyForUiMode(this, config)` from `onCreate` and
  `onConfigurationChanged` (`AndroidManifest.xml` already carries `uiMode` in
  `configChanges`). Window-inset padding stays in each `MainActivity`, because
  padding is not color policy.
- `android/` Java hosts: compiled by `android/build.py` (and
  `android/sanka/build.py`, `android/shirohan/build.py`) from this directory.

**What counts as a violation.** Anything outside this package touching
bar colors or icon appearance directly: `setStatusBarColor`,
`setNavigationBarColor`, `decorView.setBackgroundColor` (for bars),
`isAppearanceLight*`, `APPEARANCE_LIGHT_*`, `isNavigationBarContrastEnforced`.
Enforced by `scripts/check-system-bars.py` (greps for the duplication) and
per-app static checks in `packages/awai-system-bars/test/`.

**Not in scope.** Inset/padding behavior (each app keeps its own, already
aligned form), 16 KB page alignment (AWAI-3393), and apps whose canonical
source lives outside this repo (`apps/drive` is a pointer; series/cloud repos
are future work). No new permission, capability, or consent contract: this is
a local display setting.

## 対象外
- `apps/dapp-carrier`: web-only, MainActivity無し — バー色の対象自体が無いため対象外。
- `apps/drive`: awai-os内に正本が無く，正本は `network-awai/app-drive` — 外部repoのためここに未適用。
