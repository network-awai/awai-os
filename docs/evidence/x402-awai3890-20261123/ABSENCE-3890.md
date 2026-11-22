# AWAI-3890 (b)(c)(d) — なぜ「無い」と言えるか

These three defect classes were reported by the worker as **not reproduced**. This note
records the basis so that a later change reintroducing them is caught: the reproduction
tests are **kept** (`apps/x402/test/repro-3890.test.mjs`, 7 tests), so any future
regression fails the suite.

**Why "absence" is justified, not merely "tests passed":** for (b) silently-failed limits,
the test does not check just one case — `parseUsd` covers max/format/zero/empty and
`buildRequirement` covers `description.long` and `payTo.format`, and the drafts cap throws
`too-many-drafts`; every limit in x402 returns a specific code, so there is no silent path
that could swallow a violation. For (c) hidden startup errors, the test checks that all
four notice keys (`host.failed`, `state.failed`, `state.unreadable`, `state.readOnly`) have
ja+en labels AND runs a boot harness over corrupt storage showing a non-empty status line
(no blank view) — every startup failure path sets a persistent notice rendered on every
view, so no failure can be invisible. For (d) system bar colour, the test reads the actual
sources (`MainActivity.kt`, `style.css`, `AndroidManifest.xml`) and asserts the light/dark
colors, light-icon flags, `onConfigurationChanged` handling, and the `uiMode` configChanges
entry — the shared theme lib pattern is applied, so no per-app hard-coded bar colour remains.
asked by Organizer via Awai OS
