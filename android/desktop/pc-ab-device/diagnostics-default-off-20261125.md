# AWAI-4093: LineageStats diagnostics default off — 2026-11-25

No `repo sync`, no build, no VKE, no billing, no device, no production keys,
no merge. Fetch-only survey at the pinned SHAs in
`android/desktop/manifest/pinned-manifest.xml`; no repository was cloned.

## What changed

- `patches/vendor-lineage-stats-default-off.patch` — `vendor/lineage`
  `overlay/common/lineage-sdk/packages/LineageSettingsProvider/res/values/defaults.xml`:
  `def_stats_collection` `true` → `false`. **Single source of truth** for the
  shipping `LineageSettings.Secure.STATS_COLLECTION` value (see §1).
- `patches/setupwizard-stats-default-off.patch` — `packages/apps/SetupWizard`
  `app/src/main/java/org/lineageos/setupwizard/settings/LineageSettingsActivity.kt`
  `updateMetricsOption()`: absent bundle key now means unchecked (off).
  Wording unchanged — AWAI-3563 owns the strings.
- `apply.sh` — vendor loop now includes the vendor patch; SetupWizard is
  applied with the same reverse-check gate (`.kt` is not matched by `one()`'s
  `*.cfg`/`*contexts`/`*.mk` marker grep). Stack: independent of #504's
  record/CI files; merge order vs #504 is irrelevant except sharing `apply.sh`.

## 0. Applicability census (#504 baseline, per-patch verdicts)

Baseline (#504): **20 = 17 apply + 2 not applicable + 1 superseded/skipped**.
This PR adds 2 patches: `vendor-lineage-stats-default-off.patch` and
`setupwizard-stats-default-off.patch` — **both pristine `rc=0`** (no ordered
predecessor touches these files). With this PR alone:
**22 = 19 apply + 2 not applicable + 1 superseded**. With #511 (AWAI-4092,
ordered `rc=0` after `awai-pc`) also landed: **23 = 20 + 2 + 1**.

## 1. Where the default lives (file, line, value at pinned SHAs)

| # | Project / pinned SHA | File | Line | Value now |
| --- | --- | --- | --- | --- |
| S | `vendor/lineage` `5a1814d916321aecb72d60d13b5e52bc719251bd` | `overlay/common/lineage-sdk/packages/LineageSettingsProvider/res/values/defaults.xml` | 21 | `<bool name="def_stats_collection">true</bool>` → **false (this patch)** |
| A | `packages/apps/SetupWizard` `1d158e23847b5d9f9523ce6cfc51df2b0c54f6cd` | `.../setupwizard/settings/LineageSettingsActivity.kt` | 75-76 | `!containsKey \|\| getBoolean` (default checked) → **`containsKey && getBoolean` (this patch)** |
| B | `packages/apps/SetupWizard` (same SHA) | `.../setupwizard/util/SetupWizardUtils.kt` | 312-321 | writes `STATS_COLLECTION` 1/0 from bundle (no default of its own) |
| C | `packages/apps/LineageParts` `95afa906db26d2005ed8eb57d0d54ff8ee930405` | `res/xml/anonymous_stats.xml` | 17 | `android:defaultValue="true"` |
| D | same LineageParts SHA | `src/.../lineagestats/Utilities.java` | 87-90 | `getInt(..., STATS_COLLECTION, 1)` fallback on |
| E | same LineageParts SHA | `src/.../lineagestats/ReportingServiceManager.java` | 90-93 (migrate) | legacy `ANONYMOUS_OPT_IN` fallback `true` (migrates old installs) |

S is the provider seed: `LineageSettingsProvider` consumes `defaults.xml` to
seed `STATS_COLLECTION`, and every client reads/writes that same provider key
(LineageParts `Utilities.setStatsCollectionEnabled` `putInt` at
`Utilities.java:98-99`; SetupWizard `putInt` at `SetupWizardUtils.kt:315-319`).
C/D/E are fallbacks for a missing provider row and are unreachable once S
seeds the row; they are **recorded but not patched** to keep this diff to the
actual sources (see §4). A is the only other instruction of the *initial*
value, because first setup explicitly writes the setting (below), so it must
agree with S. Hence: one truth (S), one companion (A).

Overlay note: `vendor/lineage` is the overlay project pinned in the manifest;
`config/common.mk` (same SHA, lines 149-152) packages `LineageParts` +
`LineageSetupWizard` — no `stats` default in `vendor/lineage/config/common.mk`
(searched; 0 hits). No other manifest-pinned overlay carries a stats default
(code search for `stats_collection` in `android_vendor_lineage`: only
`overlay/.../defaults.xml`).

## 2. First-setup screen (default off; wording owned by AWAI-3563)

`SetupWizard` shows a "Contribute diagnostic data" switch
(`res/xml/lineage_settings_items.xml:8-11`). Exact pinned strings
(`res/values/strings.xml:92-93`, quoted — wording owned by AWAI-3563,
not edited here):

- title: `Contribute diagnostic data`
- label: `%1$s by automatically sending diagnostic and usage data to %2$s.
  This information can't be used to identify you and lends a hand to teams
  working on things like battery life, app performance, and new %3$s
  features.` (with `xliff:g` name substitutions).

`LineageSettingsActivity`
`onCreate` (lines 37-39) stores every toggle into
`SetupWizardApp.settingsBundle`; `onResume` calls `updateMetricsOption()`
(lines 73-79), which rewrites the switch from the bundle and puts the
result back. At pinned SHA the absent-key case evaluates to `true`
(checked), so an untouched Next writes `STATS_COLLECTION=1` via
`SetupWizardUtils.handleEnableMetrics` (called from `finishSetupWizard`,
`SetupWizardUtils.kt:223`; logic lines 312-321). This patch flips the
absent-key case to unchecked; text/labels are untouched (no `@string` in the
patch — asserted by `test_no_string_change`).

## 3. Why the send path is not called when the default is off

Call chain (LineageParts @ `95afa906`): `ReportingServiceManager.onReceive`
(`ReportingServiceManager.java:30-36`: `BOOT_COMPLETED` → `setAlarm`;
`ACTION_LAUNCH_SERVICE` → `launchService`) → `setAlarm`
(`ReportingServiceManager.java:38-61`: guard lines 43-45
`if (!Utilities.isStatsCollectionEnabled(context)) { return; }`, before any
alarm) and `launchService` (`ReportingServiceManager.java:63-88`: guard lines
66-68, before `startServiceAsUser(ReportingService)` at lines 85-87).
`ReportingService.onHandleIntent` (`ReportingService.java:20-60`) has no own
guard, but its only in-app starter is `launchService` (guarded) and it is
`android:exported="false"` (`AndroidManifest.xml:341-345`), so no external
caller can start it directly. If a `StatsUploadJobService` job were somehow
queued while the setting was on, `onStartJob`
(`StatsUploadJobService.java:56-66`) re-checks at lines 60-62
(`if (!Utilities.isStatsCollectionEnabled(this)) { return false; }`) and
returns without building the request or opening a connection. The HTTP POST
only exists in `uploadToLineage` (`StatsUploadJobService.java:148-174`),
reachable only from `StatsUploadTask.execute` after the guard passes.
`isStatsCollectionEnabled` (`Utilities.java:87-90`) returns the provider
value (seeded `0` after this patch on fresh installs; written `0` by setup
when the switch is off). `PreviewData.java:16-32` only renders the device
hash locally (no network). Caveat: `ReportingService.onHandleIntent` itself
would collect IDs and schedule a job if entered — the two guards above are
what keep it unreachable; `migrate()` (lines 90-93) preserves a legacy
`true` for pre-`STATS_COLLECTION` installs only when that legacy pref row
exists.

## 4. Test evidence (exact commands, exit codes)

Method per #504: each project is its own `git init` repository (a nested
directory without `.git` makes `git apply --check` a no-op).

```sh
# sparse measurement trees under .scratch-4092-4093/measure-4093 (worktree scratch)
cp vendor_defaults.xml → vendor/overlay/.../defaults.xml   # pristine @5a1814d9
cp SW_LSA.kt → sw/app/.../LineageSettingsActivity.kt         # pristine @1d158e23
git -C vendor init && git -C vendor commit          # pristine
git -C sw     init && git -C sw commit              # pristine
git -C vendor apply --check -p1 patches/vendor-lineage-stats-default-off.patch   # rc=0
git -C sw     apply --check -p1 patches/setupwizard-stats-default-off.patch      # rc=0
git -C vendor apply patches/vendor-lineage-stats-default-off.patch               # rc=0
git -C sw     apply patches/setupwizard-stats-default-off.patch                  # rc=0
git -C vendor apply --reverse --check patches/vendor-lineage-stats-default-off.patch  # rc=0 (skip gate)
git -C sw     apply --reverse --check patches/setupwizard-stats-default-off.patch    # rc=0
git -C vendor apply --check -p1 patches/vendor-lineage-stats-default-off.patch       # rc=1 (real check)
python3 android/desktop/pc-ab-device/test_diagnostics_off.py -v   # 8 tests OK
sh -n android/desktop/pc-ab-device/apply.sh                       # rc=0
```

Ordered apply: no predecessor patch touches these two files, so pristine ==
ordered. Full `apply.sh` was **not** run against a synced tree (diff-only
task); the per-project apply + reverse-check above is the claimed evidence.

## 5. Fetched: estimate vs actual; unverified

Estimate (file count × API `size`): ~40 small text files, core set ≈ 120 KB
(Kconfig/Makefile/device-mk/defconfig/defaults/SetupWizard/LineageParts survey
files) → estimate < 500 KB. Actual: 1,039,674 bytes in worktree scratch
(`wc -c .scratch-4092-4093/*`), including driver sources fetched for the
AWAI-4092 firmware-name proof and `WHENCE` excerpt; no repository cloned;
no firmware blob retained (one 1.1 MB probe of `rtw8851b_fw.bin` deleted;
see AWAI-4092 record). Disk free measured 9 GB (start) → 13 GB (later) — both
below the 15 GB threshold from pre-existing worktree load; fetches (< 2 MB
before scratch cleanup) did not change that state.

**未確認**: device confirmation after the G2 build (not claimed); full
`apply.sh` end-to-end in a synced tree; `LineageSettingsProvider` seeding
internals (provider repo not fetched — survey scope is the manifest-pinned
projects + overlay only); any behavioural claim beyond `git apply --check`
and the host test.
