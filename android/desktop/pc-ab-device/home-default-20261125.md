# Default home input (AWAI-4094) — 2026-11-25

Scope of this record: the **image inputs** for (1) preinstalling only Home and Store and
(2) making Awai Home the home screen on a fresh data partition. No build, VM boot,
device, OTA signing or production key is used here.

Decision recorded by the Organizer on 2026-11-25 (not an owner answer): preinstall Home
and Store only, keep Launcher3 as the fallback, and stop at the image input. The
Organizer's review of the first draft (2026-11-25) found that its `android:priority="999"`
does not work; this revision records the corrected input and the evidence for it.

## What the pinned platform actually reads

All revisions are those in [../manifest/pinned-manifest.xml](../manifest/pinned-manifest.xml).

| Project | Revision |
| --- | --- |
| `frameworks/base` | `0a607d06a1d6990fe6eaabd8e027c1f8d693a330` |
| `packages/modules/Permission` | `cdbbb94284627e3876c1c5a5591c619d3687de7b` |
| `build/make` | `90d006387398ae6899145e6531a304500cfa0f70` |
| `packages/apps/Launcher3` (LineageOS mirror) | `3e0e4f1955992788768547ae2c4115537bc957a6` |
| `vendor/lineage` | `5a1814d916321aecb72d60d13b5e52bc719251bd` |

There is **no `config_defaultRoleHolders` and no default-home string in `framework-res`**
at this revision. Fetched files and their SHA-256 (fetched from `raw.githubusercontent.com`
at the revisions above; nothing else was fetched or cloned):

| File | SHA-256 |
| --- | --- |
| `frameworks/base` `core/res/res/values/config.xml` | `54170561aad5c4f73a720a3f1426e7e29a0d0f1bfb312b070abf7b08763181df` |
| `packages/modules/Permission` `PermissionController/res/xml/roles.xml` | `e40eed5dffb0a2e239b5110a9cbe7666d7fdb985622d6592b90c9d6472a7fdc3` |
| `…/role-controller/java/com/android/role/controller/model/Role.java` | `a1595fe8b934efa1fb5de563c6f2c677a98d149d8173dfaca85890a3175bbc09` |
| `…/role/controller/behavior/HomeRoleBehavior.java` | `89f405ca0b14d7870025b80278902a39831b568965c9171776f03c1dfdf2fe9a` |
| `…/role/controller/service/RoleControllerServiceImpl.java` | `a29db10b18799b3231954b4350b417acd3e6d1c9ac1e83477cae25aa1635ce14` |
| `packages/modules/Permission` `service/java/com/android/role/RoleService.java` | `8bc87856050126743959e24467f7b27a7258d95e9f216d0a26b06d0e8f1b3415` |
| `packages/modules/Permission` `service/java/com/android/role/RoleShellCommand.java` | `2e5fa2b968d8b6df4f8e777cd93178c5c23d46c8f784091bcd8880324d0073ce` |
| `frameworks/base` `services/core/java/com/android/server/pm/ComputerEngine.java` | `e7d6027c6d9fe89f19a954f5070d2f8958ed530fe2f2a74209b2013281a60b33` |
| `frameworks/base` `core/java/android/content/IntentFilter.java` | `1484631ac2073d648000797c255213061ecfb2e783f1ec14f1c1a103d2e7ee6d` |

Observations with file:line at those revisions:

- `core/res/res/values/config.xml:2517-2590`: `config_defaultAssistant`,
  `config_defaultBrowser`, `config_defaultDialer`, `config_defaultSms`, … are role
  defaults. `config_showDefaultHome` (visibility, `:2530`) exists, but there is no HOME
  default string. `grep -c config_defaultRoleHolders` on that file: 0.
- `PermissionController/res/xml/roles.xml:452-493`: the `android.app.role.HOME` role has
  **no `defaultHolders` attribute**, unlike e.g. browser (`:187`
  `defaultHolders="config_defaultBrowser"`).
- `Role.getDefaultHoldersAsUser` (`Role.java:531-577`) checks the behavior, then
  `mDefaultHoldersResourceName` (a `framework-res` string). HOME has neither, so its
  default holder list is empty.
- `RoleControllerServiceImpl.onGrantDefaultRoles` (`RoleControllerServiceImpl.java:163-216`)
  removes holders that no longer qualify (`:168-181`), re-adds qualified holders, and only
  when the role has no holder (`:186`) falls back to
  `role.getFallbackHolderAsUser(...)` (`:184`, `:204`). It runs at user creation and when
  the package set changes (`RoleService.java:250,269,285,300`).
- `HomeRoleBehavior.getFallbackHolderAsUser` (`HomeRoleBehavior.java:82-115`) takes the
  HOME activity with the highest `resolveInfo.priority` and drops the candidate on a tie
  (`:105-108`); it skips the Settings fallback home (`:98-104`).
- `ComputerEngine.getDefaultHomeActivity` (`ComputerEngine.java:1064-1092`) first asks
  `mDefaultAppProvider.getDefaultHome(userId)` (`:1103`, the HOME role holder) and then
  applies the same unique-highest-priority rule.

### `android:priority` on a non-privileged Home is capped to 0

`ComponentResolver.adjustPriority` (`frameworks/base` `0a607d06`,
`services/core/java/com/android/server/pm/resolution/ComponentResolver.java:493-568`) runs
for every package's intent filters and:

- returns immediately for a priority `<= 0` (`:497`),
- caps every non-privileged app's priority `> 0` to `0` (`:506-515`; `setPriority(0)` at
  `:514`),
- keeps a privileged system app's priority (`:518-568`; `HOME` is not in
  `PROTECTED_ACTIONS` at `:99-105`), which is why the privileged setup wizard's
  `priority 9` survives.

Awai Home is a normal `product/app` prebuilt (`LOCAL_MODULE_CLASS := APPS`, no
`LOCAL_PRIVILEGED_MODULE`; `patches/virtio-common-awai-apps.patch`), so its
`android:priority="999"` became `0` at scan time and tied Launcher3's filter (also `0`).
`HomeRoleBehavior.getFallbackHolderAsUser` then returns `null` on the tie, and a fresh
`/data` has no default home. Today Launcher3 is the unique HOME activity the platform
falls back to; that is not a property Home can override with a priority.

**Conclusion.** The default home is not a framework config, and Home cannot win by
declaring a priority while it stays non-privileged. Home declares **no priority (0)** and
Launcher3's HOME filter is lowered to **-1** by
[`patches/launcher3-home-priority-fallback.patch`](patches/launcher3-home-priority-fallback.patch).
Negative priorities are not adjusted (`:497`), so the unique order is:

| Component | HOME priority | Source |
| --- | --- | --- |
| `org.lineageos.setupwizard/.SetupWizardActivity` | 9 | **Organizer observation** (`dumpsys package`, 6600H, 2026-11-25); not measured here |
| `network.awai.home` | 0 (no attribute; non-privileged) | `android/build.py` `manifest()`; `Android.mk` has no `LOCAL_PRIVILEGED_MODULE` |
| `com.android.launcher3` (`Launcher3QuickStep`) | -1 | this change's Launcher3 patch |
| Settings `FallbackHome` | -1000 | `HomeRoleBehavior.java:98-104` skips it; Organizer's 6600H observation |

The setup wizard outranks everything while it is enabled; after wizard completion its
package is disabled and Awai Home is the unique highest. Launcher3 stays the unique next
candidate, and above `FallbackHome`. Reaching a unique maximum is what makes the fallback
resolve at all; the exact wizard value is an observation, not a value this repository sets.

## Why there is no device-overlay patch for this

The overlay route the ticket suggests (`config_defaultRoleHolders` in a device overlay)
has no resource to overlay at these revisions, and overlaying a nonexistent resource is
invalid. An RRO also cannot change another APK's `AndroidManifest.xml` intent-filter
priority, and `roles.xml` lives in the `packages/modules/Permission` module (prebuilt
APEX), not in the device tree. Adding a boot-time `cmd role add-role-holder` service would
re-grant HOME on every boot and override a later user choice, so it is rejected. The
default-home inputs are the Home manifest (no priority) and the Launcher3 patch below; the
device tree's prebuilt-apps input is in the next section.

An app may still declare a priority, but a non-privileged one is capped to 0, so a
Store-installed launcher cannot outrank Home by declaring 999; it can tie it at 0. Ranking
Store-installed launchers remains a Store review and policy question; the user still sees
the HOME role dialog for a candidate launcher.

Launcher3 is **not** removed: it comes from `build/make`
`target/product/handheld_system_ext.mk:24-29` (`Launcher3QuickStep`), inherited through
`full_base.mk` → `generic_no_telephony.mk:23-26` → `handheld_system_ext.mk`, and the
device tree does not list or remove any launcher.

## Launcher3 HOME priority patch

`patches/launcher3-home-priority-fallback.patch` applies to `packages/apps/Launcher3`
(`3e0e4f19`) with `apply.sh` (`git -C <src>/packages/apps/Launcher3 apply`). It sets
`android:priority="-1"` on the HOME intent filter in **both** manifests that can enter a
build:

| Manifest | Module | Evidence |
| --- | --- | --- |
| `quickstep/AndroidManifest-launcher.xml` | `Launcher3QuickStep` | `Android.bp` `Launcher3QuickStep` (`additional_manifests`, `:584-586`); the module `handheld_system_ext.mk:27` builds |
| `AndroidManifest.xml` | `Launcher3` | `Android.bp` `Launcher3` (`:365-412`) |

`Launcher3QuickStepLib` merges `quickstep/AndroidManifest.xml` plus
`quickstep/AndroidManifest-launcher.xml`; the HOME filter is in the latter
(`:57-65`). `Launcher3` is `privileged: true` but `-1` is never adjusted
(`ComponentResolver.java:497`), so no privilege change is needed. Privileged Home (and a
priv-app allowlist) was **not** taken: it is not needed for this order, and a privileged
Home with a positive priority would instead outrank the setup wizard.

The patch was checked against the pinned revision: a shallow clone of
`LineageOS/android_packages_apps_Launcher3` at `3e0e4f19` (49 MiB, deleted after the
check) passed `git apply --check`, applied, and `git apply --reverse --check` reported
clean.

## Source-build preinstall input and its signing guard

`patches/virtio-common-awai-apps.patch` (project `device/virt/virtio-common`, pinned
`9d5c9307434bba31d19030fcc61086efcd248997`) adds, and `apply.sh` applies with the other
`virtio-common` patches:

- `awai-apps/Android.mk` — `AwaiHome` and `AwaiStore` as `BUILD_PREBUILT` modules
  (`LOCAL_MODULE_CLASS := APPS`, `LOCAL_CERTIFICATE := PRESIGNED`,
  `LOCAL_DEX_PREOPT := false`).
- `awai-apps/product.mk` — `PRODUCT_PACKAGES += AwaiHome AwaiStore` plus the fail-closed
  check; Yotei is not added.
- `awai-apps/verify-apks.sh` — compares `apksigner verify --print-certs` with the expected
  certificate SHA-256.
- `device-common.mk` — one `include $(COMMON_PATH)/awai-apps/product.mk`.

Patch paths are project-relative (the first draft carried a `device/virt/virtio-common/`
prefix that `git -C device/virt/virtio-common apply` could not match, so the include never
landed).

No APK is added by this change. Operator inputs and the failure matrix:

| Input / state | Result |
| --- | --- |
| `awai-apps/AwaiHome.apk` or `AwaiStore.apk` missing | `AWAI_APPS_FAIL: missing …`, product config `$(error)` |
| `AWAI_HOME_EXPECTED_SIGNER_SHA256` or `AWAI_STORE_EXPECTED_SIGNER_SHA256` unset | `AWAI_APPS_FAIL: … is unset`, `$(error)` |
| `AWAI_APKSIGNER` unset or not executable | `AWAI_APPS_FAIL: …`, `$(error)` |
| signer digest differs, or the APK has no signer | `AWAI_APPS_FAIL: … signer … != expected …`, `$(error)` |
| both APKs present, both digests match | `AWAI_APPS_OK: …`, the modules are added |
| `AWAI_ALLOW_UNVERIFIED_APKS=1` on a development build | warning, digests are not compared |
| `AWAI_ALLOW_UNVERIFIED_APKS=1` with `TARGET_BUILD_VARIANT=user` | `$(error)`: refused |
| `AWAI_WITHOUT_APPS=1` on a development build | `AWAI_WITHOUT_APPS: Home/Store are NOT preinstalled`; nothing is added |
| `AWAI_WITHOUT_APPS=1` with `TARGET_BUILD_VARIANT=user` | `$(error)`: refused |
| `AWAI_WITHOUT_APPS=1` with `LINEAGE_BUILDTYPE=RELEASE` | `$(error)`: refused |
| `AWAI_WITHOUT_APPS` unset or `0` | the normal fail-closed check runs |

`AWAI_WITHOUT_APPS=1` is the explicit escape for an evaluation build of other device-tree
changes without the operator APKs. The release test is real, not invented: the variant is
`TARGET_BUILD_VARIANT=user` (`build/make`), and a LineageOS release carries
`LINEAGE_BUILDTYPE=RELEASE` (`vendor/lineage/config/version.mk:21-22`, exported as
`ro.lineage.releasetype` at `:45`); `vendor/lineage/config/common.mk:303` includes
`version.mk`, and `lineage_virtio_x86_64.mk:11` inherits that common config before
`device.mk` at `:14`, so the value is set when `product.mk` is parsed. The default stays
fail-closed; the escape is never implied by an unset variable.

The expected signer values are deliberately not committed: the shipping signing key is not
decided. Today `android/build.py` signs the APKs with the local Android debug identity by
default (`android/build.py:15,81,237`), and `--release` refuses that identity
(`android/build.py:114-117,239-243`). Until the key decision, a shipping build cannot pass
this guard.

## Risk and recovery (Awai Home unusable)

| State | Observed code path | Result |
| --- | --- | --- |
| Awai Home uninstalled/disabled | `RoleControllerServiceImpl.java:168-181` removes the holder when it no longer qualifies; then the fallback (`:184`) is the unique remaining HOME | Launcher3 becomes home again |
| Awai Home installed but fails to start | It still qualifies; the role holder stays | Home key stays on the failing app |

Recovery for the second row: Settings → Apps → Default apps → Home app → Launcher
(Settings is reachable from the notification shade/quick settings). The `user` build has
ADB off by default, so the UI route is the supported one; with a development `userdebug`
image, `cmd role add-role-holder --user 0 android.app.role.HOME com.android.launcher3`
(`RoleShellCommand.java:82,197`) also works. Both commands are verified to exist in the
pinned source; neither was run on a device here.

## Acceptance list (not run here)

Every row is unverified in this change. Use a fresh `/data` (tmpfs or a new userdata
image) and record the command output.

| # | Step | Pass |
| --- | --- | --- |
| 1 | First boot of a fresh `/data` | the setup wizard is shown; `getprop sys.user_setup_complete` is `0` before it finishes |
| 2 | After wizard completion (no manual home choice) | `cmd role get-role-holders --user 0 android.app.role.HOME` is `network.awai.home` |
| 3 | Second boot after the wizard | the holder is still `network.awai.home`; the HOME key opens Awai Home without `am start` |
| 4 | Home absent or disabled (`pm disable-user --user 0 network.awai.home`), reboot | the holder is `com.android.launcher3`; Launcher3 is usable after unlock and a HOME press |

Row 1 depends on the setup wizard's own behaviour, which this change does not alter. Row 4
is the Launcher3 `-1` input; if it fails, record whether the holder is null or a different
package before changing the input.

## Verified / Not verified

Verified on 2026-11-25 (this change):

- `ComponentResolver.adjustPriority` and its `<= 0` early return, non-privileged cap and
  privileged path, read at `frameworks/base` `0a607d06`
  (`services/core/java/com/android/server/pm/resolution/ComponentResolver.java:493-568`);
  `HomeRoleBehavior.getFallbackHolderAsUser` tie handling at `Permission` `cdbbb942`
  (`:82-115`)
- `Launcher3QuickStep`'s built manifests from `packages/apps/Launcher3` `3e0e4f19`
  (`Android.bp` `Launcher3QuickStep`, `quickstep/AndroidManifest.xml`,
  `quickstep/AndroidManifest-launcher.xml`, `AndroidManifest-common.xml`)
- the Launcher3 patch applies at `3e0e4f19`: shallow clone (`git fetch --depth 1` of the
  pinned commit), `git apply --check` clean, applied, `git apply --reverse --check` clean;
  clone deleted afterwards
- the apps patch applies at `device/virt/virtio-common` `9d5c9307` with project-relative
  paths: fresh repository with the pinned `device-common.mk`, `git apply --check` clean,
  applied (`awai-apps/{Android.mk,product.mk,verify-apks.sh}`), reverse-check clean
- `sh -n android/desktop/pc-ab-device/apply.sh`,
  `bash -n android/desktop/derived-image/build-images.sh`
- `python3 android/build.py` remains importable; the generated Home manifest's HOME filter
  has no `android:priority` and the LAUNCHER filter is unchanged
- `python3 -m unittest test_home_apps` (26 checks, `android/desktop/pc-ab-device`):
  project-relative patch paths, new-file hunk lengths, the Home non-privileged/priority
  regression, the Launcher3 `-1` filter in both manifests, the verify-apks.sh cases, and
  `product.mk` under GNU make (missing APK / unset expected value / mismatch → error;
  `AWAI_WITHOUT_APPS=1` on `userdebug` → warning and no module; `user` and
  `LINEAGE_BUILDTYPE=RELEASE` → error; `0` keeps the guard; verified APKs are added)
- the Bazel target `//android/desktop/pc-ab-device:home_apps_test` data now includes
  `//android:build.py` and `//store/catalog-source:series-apps.json`; it was not run here
  (no Bazel output base, and installing one is out of scope for this change)

Not verified (no AOSP build, VM or device was run):

- a real `lunch`/`make` of the patched tree (the applied files were exercised with GNU make
  and a stub `apksigner`, not by kati/Soong)
- x86_64 build and VM boot of the derived image with two apps
- default home on a fresh `/data`, and retention across a reboot (acceptance rows 1-3)
- the Launcher3 fallback with `-1` (Home absent, Home not starting; acceptance row 4)
- Store install and launch of Yotei
- physical Desktop boot, OTA, and the AWAI-3061 source build (signed target-files exist in
  Linear; no reproducible source build exists in this repository)
- the setup wizard's priority 9 on the 6600H (Organizer's `dumpsys` observation, not rerun
  here)

## Procedure for the unverified checks

Use the derived image (`build-images.sh` output) with tmpfs `/data`, or the AWAI-3061
source build when a reproducible one exists; record which one.

1. **Signing guard (source build).** In the patched checkout, each of these must stop
   before compiling: `lunch`/`make` with the APKs absent; with the APKs present but
   `AWAI_HOME_EXPECTED_SIGNER_SHA256`/`AWAI_STORE_EXPECTED_SIGNER_SHA256` unset; with a
   signer that differs from the expected value; with `AWAI_ALLOW_UNVERIFIED_APKS=1` and
   `TARGET_BUILD_VARIANT=user`. Then supply both APKs, `AWAI_APKSIGNER` and the expected
   digests: the include passes and `AwaiHome`/`AwaiStore` are in `PRODUCT_PACKAGES` (check
   `out/.../installed-files.txt` or the built `system.img`). Do not build or ship with
   `AWAI_ALLOW_UNVERIFIED_APKS=1` outside a development image. Separately, on a
   `userdebug` tree with no APKs, `AWAI_WITHOUT_APPS=1` must print the warning and build
   without either app; the same value must stop a `user` build and a
   `LINEAGE_BUILDTYPE=RELEASE` build.
2. **Image inputs.** Rebuild the APKs (`python3 android/build.py --version <n> --skip-cljs
   --out <dir>`) and the derived image, then confirm the image contains
   `/system/product/app/AwaiHome` and `AwaiStore` and **no** `AwaiYotei`. Pass:
   `adb shell ls /system/product/app` shows exactly the two new directories, and
   `build-images.sh` reports no missing APK.
3. **x86_64 boot.** Boot the image in a QEMU x86_64 VM with tmpfs `/data`. Pass:
   `sys.boot_completed=1`, `pm list packages | grep network.awai` shows
   `network.awai.home` and `network.awai.store`, and no crash entries for either.
4. **Default home (acceptance rows 1-3).** On a fresh `/data`, the wizard must be shown and
   `getprop sys.user_setup_complete` must be `0` before it finishes. Complete the wizard
   without choosing a home, then read
   `cmd role get-role-holders --user 0 android.app.role.HOME`. Pass: `network.awai.home`.
   Reboot, unlock, and read the holder again plus
   `cmd package resolve-activity --brief -a android.intent.action.MAIN
   -c android.intent.category.HOME`. Pass: the holder is still `network.awai.home` and the
   HOME key opens it without `am start`. APKs built with the first draft's `999` fail this
   step; that is the expected result, not a regression.
5. **Launcher3 fallback (acceptance row 4).** Throwaway VM, userdebug image; no new APK is
   added for this test.
   - *Home absent.* Use the pinned base image without the derived apps, or on a disposable
     VM disable the installed Home (`pm disable-user --user 0 network.awai.home`), then
     reboot. Pass: `cmd role get-role-holders --user 0 android.app.role.HOME` is
     `com.android.launcher3`, a usable Launcher3 screen appears after unlock without
     `am start`, and a HOME press shows it again (workspace drawn, app drawer opens, an
     app launches).
   - *Home installed but not starting.* Keep `network.awai.home` installed and the role
     holder. On a debuggable `userdebug` image, simulate the start failure with
     `am crash network.awai.home` (a simulation, not a real crash) and press HOME. Record
     what the user sees and whether the shade/Settings stay reachable. Then Settings → Apps
     → Default apps → Home app → Launcher, press HOME. Pass: the Launcher3 screen is usable
     and the HOME press works after the switch.
6. **Store to Yotei.** In Store, install Yotei, then launch it. Pass: after install
   `pm list packages` shows `network.itonami.yotei`, its signer matches the APK the Store
   shipped, the preinstall directories are still only Home and Store, and Yotei's screen
   opens. Do not read this as preinstall evidence: the app must not be in
   `/system/product/app`.
