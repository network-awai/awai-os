# Patch applicability at pinned SHAs (AWAI-4089 G2) — 2026-11-25

**AWAI-4088 範囲5 / AWAI-4089 の記録** — 適用可否はこの単体の文書に記録する
（PR 本文だけでは不可）。以下、pinned SHA・対象 project・patch ごとの
files・コマンド・結果・不適用理由・取得ファイルの sha256 を全てこの文書に含める。

No `repo sync`, no build, no VKE run, no billing, no device, no
production keys. Only the files the patches touch were fetched, at the
exact revisions in `android/desktop/manifest/pinned-manifest.xml`
(SHA-256 `61c11f507fa14329229c16a635890b2c6d5f2f4e5a648a77045a09f7f4194d7d`,
1264 projects, every `revision` 40-hex — verified with
`shasum -a 256`). Target projects and files come from each patch's
`diff --git` headers and from the apply mapping in
`pc-ab-device/apply.sh`, `apply-shipping-debug-lockdown.sh`,
`pc-firmware.py`, `updater-feed.py` and
`scripts/operator/same-build/build-inside.sh` — nothing guessed.

## Totals

- **20 patches inventoried** (18 under `pc-ab-device/patches/`, plus
  `target-files/mkbootimg-header-version.patch`, plus
  `scripts/operator/same-build/inputs/setupwizard-awai.patch`).
- **17 applicable** at the pinned SHAs under the repo's own apply order
  (see "Ordered apply" below).
- **2 genuinely not applicable** at the pinned SHAs:
  - `mkbootimg-header-version.patch` — confirmed not applicable at
    `device/mainline/generic` `3d402dc5`: the fetched `BoardConfig.mk`
    contains no `BOARD_BOOT_HEADER_VERSION` (0 matches) and sets
    `AB_OTA_UPDATER := false` (line 12) — the same conclusion as the
    G1 record (`AWAI3850_GENERIC_FIX_SKIPPED` in AWAI-3850).
  - `virtio-userdata.patch` — base `configs/fstab/fstab.virtio-common`
    (635 bytes) no longer matches; the fstab selection then chooses
    `virtio-userdata-block-checkpoint.patch` instead (see below).
- **1 superseded / skipped** (not an error):
  - `virtio-userdata-ext4-checkpoint.patch` — after the chosen block
    variant is applied, **`apply.sh` skips it via
    `git apply --reverse --check` (rc=0)**, then applies the wait
    patch. A forward `git apply --check` of this patch therefore
    returns rc=1 **only because the content is already there** — the
    rc=1 in an earlier local replay was a forward check run *without*
    `apply.sh`'s `--reverse --check` gate, not an `apply.sh` failure.
    `apply.sh` exits 0 on the first and the second run at the pinned
    SHAs (re-measured on per-project repositories below).
- Chosen userdata-fstab variant at the pinned SHA:
  **`virtio-userdata-block-checkpoint.patch`** (single variant, never
  double-applied).

## Pinned revisions of the target projects

| Project path | Repository (remote `github: https://github.com/`) | Pinned revision |
| --- | --- | --- |
| `device/virt/virtio-common` | `LineageOS/android_device_virt_virtio-common` | `9d5c9307434bba31d19030fcc61086efcd248997` |
| `device/virt/virt-common` | `LineageOS/android_device_virt_virt-common` | `5da818292d9a66cf282e909287fdab14eb80711b` |
| `device/virt/virtio_x86_64` | `LineageOS/android_device_virt_virtio_x86_64` | `0e8571a0d7fce749856e9dea72e99a8a83f8f9b4` |
| `device/mainline/common` | `LineageOS/android_device_mainline_common` | `e237088ec3475c6b93e7148bdcc32218e36f782f` |
| `device/mainline/generic` | `LineageOS/android_device_mainline_generic` | `3d402dc58aa2086a960abd076204836259387a79` |
| `vendor/lineage` | `LineageOS/android_vendor_lineage` | `5a1814d916321aecb72d60d13b5e52bc719251bd` |
| `build/make` | `LineageOS/android_build` | `90d006387398ae6899145e6531a304500cfa0f70` |
| `packages/apps/Updater` | `LineageOS/android_packages_apps_Updater` | `1445c6104ffb33123d4e449a60e3c054ed5a9ee0` |
| `packages/apps/SetupWizard` | `LineageOS/android_packages_apps_SetupWizard` | `1d158e23847b5d9f9523ce6cfc51df2b0c54f6cd` |

## Applicability table

"Files" names the `a/`-side paths fetched before checking (a new
`b/`-side file from `/dev/null` needs no fetch). "Pristine" is
`git apply --check -p1` against the pristine pinned revision of that
project only; "Ordered apply" is the repo's own apply order
(`apply.sh`, `apply-shipping-debug-lockdown.sh`, `pc-firmware.py`,
`updater-feed.py`), where stacked patches are checked against the
state the earlier patches in the order have already produced. Order
was `apply.sh` canonical: virtio-common (`awai-pc` → `aw-mesa-sphal`
→ chosen fstab → wait; the checkpoint patch is skipped via
`--reverse --check` rc=0), virt-common (`awai-pc` → `boot-name`, lockdown `user-no-adb-tcp` after
`awai-pc`), virtio_x86_64 (`radeon` → `radeon-default`), updater
(`withdrawal` → `serialize` → `maintenance`, all with
`--unidiff-zero` as in `updater-feed.py`).

| Patch | Target project | Files (fetched `a/`-side) | Pristine | Ordered apply | Verdict |
| --- | --- | --- | --- | --- | --- |
| `virtio-common-awai-pc.patch` | `device/virt/virtio-common` | `BoardConfigCommon.mk`, `sepolicy/vendor/ab/file_contexts`, `sepolicy/vendor/file_contexts` (+ new `configs/kernel/awai-pc.config`) | `rc=0` | `rc=0`, first in order | applies |
| `virtio-common-aw-mesa-sphal.patch` | `device/virt/virtio-common` | `sepolicy/vendor/file_contexts` | `rc=1` (`sepolicy/vendor/file_contexts: patch does not apply`) | `rc=0` after `virtio-common-awai-pc.patch` (context differs) | applies in order |
| `virtio-userdata.patch` | `device/virt/virtio-common` | `configs/fstab/fstab.virtio-common` | `rc=1` (`fstab.virtio-common:1`) | fstab selection skips it: forward-check fails, reverse-check fails | **not applicable** at pinned SHA; chosen variant is `virtio-userdata-block-checkpoint.patch` |
| `virtio-userdata-block-checkpoint.patch` | `device/virt/virtio-common` | `configs/fstab/fstab.virtio-common` | `rc=0` | `rc=0` (chosen) | applies (chosen variant) |
| `virtio-userdata-ext4-checkpoint.patch` | `device/virt/virtio-common` | `configs/fstab/fstab.virtio-common` | `rc=1` (`fstab.virtio-common:1`) | forward `--check` rc=1 after chosen variant (content already there); `--reverse --check` rc=0 (skipped by `apply.sh`) | **superseded / skipped** by `apply.sh` (reverse-check gate), not a failure |
| `virtio-userdata-ext4-checkpoint-wait.patch` | `device/virt/virtio-common` | `configs/fstab/fstab.virtio-common` | `rc=1` (`fstab.virtio-common:1`) | `rc=0` after chosen variant | applies in order |
| `virt-common-awai-pc.patch` | `device/virt/virt-common` | `BoardConfigVirtCommon.mk`, `bootmgr/grub/grub-boot.cfg`, `configs/fstab/fstab.virt-common`, `configs/properties/vendor.prop` | `rc=0` | `rc=0` first | applies |
| `virt-common-awai-boot-name.patch` | `device/virt/virt-common` | `build/tasks/10-bootmgr-defs.mk` | `rc=0` | `rc=0` after `virt-common-awai-pc.patch` | applies |
| `virt-common-user-no-adb-tcp.patch` | `device/virt/virt-common` | `configs/properties/product.prop`, `virt-common.mk` | `rc=0` | `rc=0` after `virt-common-awai-pc.patch` (the lockdown documented state) | applies in order |
| `virtio-x86-64-awai-radeon.patch` | `device/virt/virtio_x86_64` | `BoardConfig.mk`, `bootmgr/grub/grub-boot.cfg`, `configs/init/virtio_x86_64-graphics.rc` | `rc=0` | `rc=0` first (per `pc-firmware.py prepare` order) | applies |
| `virtio-x86-64-awai-radeon-default.patch` | `device/virt/virtio_x86_64` | `bootmgr/grub/grub-boot.cfg` | `rc=0` | `rc=0` after `virtio-x86-64-awai-radeon.patch` | applies |
| `vendor-lineage-no-ota-downgrade.patch` | `vendor/lineage` | `config/common.mk` | `rc=0` | `rc=0` | applies |
| `vendor-lineage-kernel-output-prefix.patch` | `vendor/lineage` | `build/tasks/kernel.mk` | `rc=0` | `rc=0` | applies |
| `build-no-trade-in-mode-trigger.patch` | `build/make` | `target/product/handheld_system.mk` | `rc=0` | `rc=0` | applies |
| `mainline-common-user-no-insecure-debugging.patch` | `device/mainline/common` | `libraries/libinit/Android.bp`, `libraries/libinit/libinit_mainline_common.cpp` | `rc=0` | `rc=0` | applies |
| `updater-empty-feed-withdrawal.patch` | `packages/apps/Updater` | `app/src/main/java/org/lineageos/updater/data/UpdatesRepository.kt` | `rc=0` (`--unidiff-zero`) | `rc=0` first (`updater-feed.py` order) | applies |
| `updater-serialize-ab-preparation.patch` | `packages/apps/Updater` | `app/src/main/java/org/lineageos/updater/controller/ABUpdateInstaller.java` | `rc=0` (`--unidiff-zero`) | `rc=0` second | applies |
| `updater-pc-maintenance.patch` | `packages/apps/Updater` | `ABUpdateInstaller.java`, `UpdatesRepository.kt`, `UserPreferencesRepository.kt`, `PreferencesScreen.kt`, `UpdatesCheckWorker.kt`, `res/values/strings.xml`, `res/values-ja/strings.xml`, `UpdaterController.java` (+ new `PcMaintenance.kt`, `PcPackagePolicy.java`) | `rc=1` (`ABUpdateInstaller.java:48`) | `rc=0` after withdrawal + serialize (`--unidiff-zero`) | applies in order |
| `mkbootimg-header-version.patch` | `device/mainline/generic` | `BoardConfig.mk` | `rc=1` (`BoardConfig.mk:13`) | `rc=1` (unchanged tree) | **not applicable** — no `BOARD_BOOT_HEADER_VERSION` at `3d402dc5` (see above) |
| `setupwizard-awai.patch` | `packages/apps/SetupWizard` | `WelcomeActivity.kt`, `locale/LocaleActivity.kt`, `settings/LineageSettingsActivity.kt` | `rc=0` (at pinned `1d158e23`) | `rc=0` | applies at the pinned SHA. Divergence recorded: `build-inside.sh` checks out `d995f1a1949f5988850c9977658e2590efe502b4` before applying; this ticket measured at the manifest-pinned `1d158e23` as instructed |

## Measured method notes

Two methodological details are load-bearing:

- **Every project must be its own git repository for measurement.** A
  project directory with no `.git` of its own, nested inside another
  repository, makes `git apply --check` exit 0 without checking
  anything (Git only operates on the outer repository's index, and a
  patch that trips no outer-repo path filter parses as a no-op).
  Every command in this document ran in a per-project `git init`
  scratch directory, and the scratch state can be
  reproduced with the commands under "Reproduce".
- **rc=1 origin for the checkpoint patch.** An earlier local replay
  obtained `rc=1` for `virtio-userdata-ext4-checkpoint.patch` from a
  forward `git apply --check` run *without* `apply.sh`'s
  `--reverse --check` gate (`apply.sh:56-58`): the gate sees the
  patch already applied (rc=0) and skips it. Re-running the real
  `apply.sh` on pinned trees (per-project repositories, run 1 and run
  2) gives rc=0 both times:
  - run 1 applies `virtio-common-awai-pc`, `virtio-common-aw-mesa-sphal`,
    the chosen `virtio-userdata-block-checkpoint`, then the wait patch
    (`virtio-common ext4 userdata checkpoint device wait: enabled`);
    the checkpoint patch is silently skipped (already satisfied),
    then both vendor patches apply. `apply.sh` exits 0.
  - run 2 reports everything already applied and exits 0.
  The same `apply.sh` virtio-common / vendor/lineage results are
  identical to the ordered table above.
- **The Updater 17 is correct.** The three Updater patches apply
  through `updater-feed.py configure_release` (`updater-feed.py:65`
  `git apply --unidiff-zero`); a plain `git apply --check` returns
  rc=1 on the pinned Updater `1445c610…` and `--unidiff-zero` gives
  rc=0. `apply.sh` never handles Updater, so its lack of that flag is
  not a signal. (The "13 applicable" figure in the #505 evidence
  README counted a different set and is superseded here.)
- **Radeon patches are applied by `pc-firmware.py prepare`, not
  pre-applied by the Job** (one path): `prepare` applies both
  `virtio-x86-64-awai-radeon.patch` and
  `virtio-x86-64-awai-radeon-default.patch` after staging the
  firmware overlay.
- **pc-firmware pin alignment.** `pc-firmware.py` hard-checked
  `device/virt/virtio_x86_64` HEAD against `50dc1471…`. That SHA is
  not resolvable upstream (GitHub API 422 when resolving the commit;
  Gerrit full-text search by SHA returned 0; no tag or branch at that
  SHA in the upstream repository survey) — the same profile as the
  old `4cc0f606…` build-input SHA recorded in the G1 evidence: a
  host-local commit from the 7735HS/PC release kit era, not a
  reproducible upstream pin. The pin was realigned to the pinned
  manifest revision `0e8571a0d7fce749856e9dea72e99a8a83f8f9b4`.
  Proof (scratch, sparse fetches only): device tree shallow-fetched
  at `0e8571a0`, firmware tree shallow-fetched at `a2dcb924`
  (kernel.org `linux-firmware`), 13 r8168 blobs cross-checked
  byte-identical between the lineage `external/linux-firmware-mainline`
  tree at pinned `c0dcca3a` and the firmware repository
  (`raw.githubusercontent.com/LineageOS/android_external_linux-firmware-mainline/
  c0dcca3ad25e261abfbd1c0d42219c81a1f48496/firmware/r8168/rtl_nic/<file>`).
  `prepare` then ran end-to-end (exit 0, idempotent on rerun):
  Radeon patches applied, `PRODUCT_PACKAGES`/`PRODUCT_COPY_FILES`
  overlay created at `vendor/awai/pc-firmware` (18 entries) and the
  firmware include injected into `lineage_virtio_x86_64.mk`.

## Raw evidence provenance

`patch-applicability-20261125-raw/` ports the raw measurement logs
from the closed companion PR #505 (`com-junkawasaki/awai-4088-g2-followup`,
branch retained) — `raw/fetch.log`, `raw/chains.txt`, `raw/pristine.txt`,
`raw/patches.sha256`, `raw/manifest-inputs-patches.txt`,
`SHA256SUMS` — verbatim; no counts from that PR's README are
reproduced here (its "13 applicable" exclusions are superseded by
this document's 17; see above). The committed Job at
`scripts/operator/virtio-dryrun/` supersedes #505's Job definition
rather than copying its apply step (which ran only `apply.sh` and
dropped Radeon, lockdown and Updater): patch application in this Job
calls the repo's own tools, never a second explicit list.

## Latent blockers for a real (non-dry-run) build at the pinned SHAs

- **Resolved in this round:** the `pc-firmware.py`
  `DEVICE_REVISION` divergence (see "pc-firmware pin alignment"
  above; `50dc1471…` was a host-local SHA, not a reproducible
  upstream pin). The pin is now the manifest's `0e8571a0…` and
  `prepare` was proved to pass in a scratch tree.
- `updater-feed.py` hard-codes the Updater revision `1445c610…`,
  which *does* match the pinned Updater revision — no divergence.
- `README.md` recorded baselines (e.g. `virtio-common` `e6f2a7d2`)
  predate the pinned `9d5c9307`; the table above supersedes them for
  the pinned manifest.
- Still unverified (a run would need an approved build node):
  `apply.sh`/lockdown runs in a real synced tree (the scratch
  reproductions above used the fetched files only), the lockdown
  patch set in a real build product, and OTA registration
  end-to-end. The G2 dry-run Job records the plan; it is not
  evidence of a build.

## Product target

`lineage_virtio_x86_64` exists at the pinned device revision:
`lineage_virtio_x86_64.mk` fetched from
`LineageOS/android_device_virt_virtio_x86_64 @ 0e8571a0d7…`
(SHA-256 `381157f51234eec7d8fad38e3dbe5a9fc289c3e338af0f4a56b8e4434e79eb83`,
`PRODUCT_NAME := lineage_virtio_x86_64`,
`PRODUCT_DEVICE := virtio_x86_64`), so
`breakfast lineage_virtio_x86_64` is the correct target name.

## Fetched files (only patch-touched `a/`-side paths)

Raw URL used:
`https://raw.githubusercontent.com/<LineageOS/android_*>/<pinned-sha>/<path>` —
identical content to `git fetch --depth 1 <url> <sha>` at that
revision; verified per file below.

| Project path | Path | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `build/make` | `target/product/handheld_system.mk` | 4299 | `407e143f8d4cc6c84a3175ef93a4b0a7d359d0d20595e5d77fc8385154aaa1f7` |
| `device/mainline/common` | `libraries/libinit/Android.bp` | 1322 | `e5f5cba53d6cc60de116d036e140c6694eb3d9cb6af16b5d794b67b5170cfe3b` |
| `device/mainline/common` | `libraries/libinit/libinit_mainline_common.cpp` | 889 | `07cff6f5d49dc8fc790a061043d699c6f2bd80f244ccf3b0e37fb2ce4b452abc` |
| `device/mainline/generic` | `BoardConfig.mk` | 3787 | `616464a1d545dbf232504b37b9e96790354f6ab7c48b9ef820968722c74c3936` |
| `device/virt/virt-common` | `BoardConfigVirtCommon.mk` | 5257 | `21fef0b8b3bbf3fe73c27a51506a120d7780559f28d2e5a47d8b63c7db463173` |
| `device/virt/virt-common` | `bootmgr/grub/grub-boot.cfg` | 24959 | `afb14edccf5e33e2a5df24f4bb9a2fa17b74330bfb6d3ae3143c9224bd1979f0` |
| `device/virt/virt-common` | `build/tasks/10-bootmgr-defs.mk` | 2789 | `997190870cc2a49d37158d99367962bb45d20695183c7bb44aff6f51d57968d2` |
| `device/virt/virt-common` | `configs/fstab/fstab.virt-common` | 729 | `492557819a3963665826e0f2136101db5eb2c9feba0ccaa6763f420bfb7d42df` |
| `device/virt/virt-common` | `configs/properties/product.prop` | 93 | `1b7927aea09948bd5431ca696d77a5bde3f970a1b010e77ddb112a0b12f14e5e` |
| `device/virt/virt-common` | `configs/properties/vendor.prop` | 377 | `9804d4fa3f8aba9b67ce5292aaf80d9752cb97ee087e31d14196123287fdc777` |
| `device/virt/virt-common` | `virt-common.mk` | 8170 | `9a76914fd596439c249266e85b7a8de9a8c862a4d8b9573cf0a359baf6d999b2` |
| `device/virt/virtio-common` | `BoardConfigCommon.mk` | 1916 | `992b74868659265699c6c56facdfd8ef1ca4fb1938c053b5969f73232462a3e4` |
| `device/virt/virtio-common` | `configs/fstab/fstab.virtio-common` | 635 | `b23b55582109ee5036967718c8988e7bd1963db5d0508e3e62c71f7be1abaf18` |
| `device/virt/virtio-common` | `sepolicy/vendor/ab/file_contexts` | 222 | `22e35ce739726ae507cfd253317e7a597e3eef498625db7da4f1f00c4ea2e290` |
| `device/virt/virtio-common` | `sepolicy/vendor/file_contexts` | 540 | `3d9160a22a770da4d141f504fed9c36ce148d989d2cda35916dcb86c04d95dd1` |
| `device/virt/virtio_x86_64` | `BoardConfig.mk` | 1183 | `3ef24c4f371d87f8f09d3238dd46fed3497166f388de4a8f7e379fb31a52ec1e` |
| `device/virt/virtio_x86_64` | `bootmgr/grub/grub-boot.cfg` | 2547 | `651eae01c80356a2c8668f0e34bee2be5576b082c6c83be4b437f189de99d4de` |
| `device/virt/virtio_x86_64` | `configs/init/virtio_x86_64-graphics.rc` | 875 | `4aadeb69043243d783ff5a4a01b21761b6778e9d86845bddb1c23c02250b0245` |
| `packages/apps/SetupWizard` | `app/src/main/java/org/lineageos/setupwizard/WelcomeActivity.kt` | 5726 | `d0ff5b24c0c9cd872f0d18e804c714336a97e38acdca5dcde219cfce99fef616` |
| `packages/apps/SetupWizard` | `app/src/main/java/org/lineageos/setupwizard/locale/LocaleActivity.kt` | 10085 | `4bde9f4b7e53aeb056cccaefbb6d37b9a4aad36c84b5ea2758757538a3c12eca` |
| `packages/apps/SetupWizard` | `app/src/main/java/org/lineageos/setupwizard/settings/LineageSettingsActivity.kt` | 3884 | `d6a97a3b9e1493a117542c656e9a085584c5d4238df33b1b4b5d3ab39800745f` |
| `packages/apps/Updater` | `app/src/main/java/org/lineageos/updater/controller/ABUpdateInstaller.java` | 15878 | `d5f644bdb139c0ad10a8a4cd24f54d79268f12421dab9b13706b0144f95c0356` |
| `packages/apps/Updater` | `app/src/main/java/org/lineageos/updater/controller/UpdaterController.java` | 25263 | `3957a30343826540c9e9d19fde33695c655b50480c35f8d6c27f93d3ff6e92f8` |
| `packages/apps/Updater` | `app/src/main/java/org/lineageos/updater/data/UpdatesRepository.kt` | 4512 | `d90ab903d5631d2d70ca063cd72bc558dd6af367ab12088a7bbeded957236bc4` |
| `packages/apps/Updater` | `app/src/main/java/org/lineageos/updater/data/UserPreferencesRepository.kt` | 5214 | `6fe5c4b5525dd0da4d8d9c9a94156ab87d19c6289c5452513b6cb704c7ceccdf` |
| `packages/apps/Updater` | `app/src/main/java/org/lineageos/updater/download/HttpURLConnectionClient.java` | 12648 | `87509e8ee5f9647b475840c226f161cdd756715d8131d0558c0eec00b9a2ecee` |
| `packages/apps/Updater` | `app/src/main/java/org/lineageos/updater/download/SingleRangeHttpFetcher.kt` | 1949 | `09ec18e8c1ed909eee37afcec3c213609a948ccd6837640fdfe01fd75cd4781d` |
| `packages/apps/Updater` | `app/src/main/java/org/lineageos/updater/preferences/PreferencesScreen.kt` | 8430 | `9a09a7e45625682cd6275e4be655c670c26734710e9c587c80aa6dbb773c3b2e` |
| `packages/apps/Updater` | `app/src/main/java/org/lineageos/updater/updatescheck/UpdatesCheckWorker.kt` | 4419 | `132d4d46826588a276d53f747e2cdb2c7b306649121ae1763dbc874b18f13515` |
| `packages/apps/Updater` | `app/src/main/res/values/strings.xml` | 13392 | `e8874e2a6554c7fa40204feab4ebe4a767a0d3cfac40a8729d0751b0cf6ee5c4` |
| `packages/apps/Updater` | `app/src/main/res/values-ja/strings.xml` | 14025 | `495e4787126654ee016af722d48139597723df6702e765ff73044cf7d58181c4` |
| `vendor/lineage` | `build/tasks/kernel.mk` | 41311 | `55c02c09644722f44782fce97c06edf84b7f076514f971b58da4afd69b8a9180` |
| `vendor/lineage` | `config/common.mk` | 8310 | `5798ba088072a162e2df3e3327c0ebcc6678c37e2b298c5c8bc2dd4399ccf2e4` |

Patch files themselves (SHA-256, from the repo):

| Patch | SHA-256 |
| --- | --- |
| `build-no-trade-in-mode-trigger.patch` | `bd6b765d9ddbae857525c1778dfe286fd01f52f824e031f565babc40a52575b1` |
| `mainline-common-user-no-insecure-debugging.patch` | `1fe48fe0027594796b8a99d4e367e3b8c6d53c0265e8a6483b37c7bbaa74436e` |
| `updater-empty-feed-withdrawal.patch` | `1cdb1b49fc0bcfd553a886d58f98f7fd2952be034d2527575fcb11077b01ff35` |
| `updater-pc-maintenance.patch` | `600b2685208ab2cf0305cf763eeb772e2c44cb2d71ed3bb9f7778785cba0a9b2` |
| `updater-serialize-ab-preparation.patch` | `825a5e82ad4e09c9fd3410f2fe51f316f45c8cc13c55d5f02dfba28e3dd114e9` |
| `vendor-lineage-kernel-output-prefix.patch` | `7e3073b68f625c1d5b596ba85e7fa9f2cdc07b92b01fee34586362aaef04a033` |
| `vendor-lineage-no-ota-downgrade.patch` | `dc018af33da42827f1b9d21f16e44e99d5b4923009173eb7585658bea03d926d` |
| `virt-common-awai-boot-name.patch` | `ed9eacea16b97901f32aec688cf10a404490803b551e1b06b414a27036f98d60` |
| `virt-common-awai-pc.patch` | `4a2b4adae8aa18b131a304c33c782c8829264a2968d6a63b0609b15c58867e83` |
| `virt-common-user-no-adb-tcp.patch` | `7bcc960ab4565d4335d5ad51957d6fb5c63173fb732d17fb04f5ad511f174c39` |
| `virtio-common-aw-mesa-sphal.patch` | `5e825c710eb39e94eaea9da326fb00723746296d3cbe03b613dc4b367ad232d9` |
| `virtio-common-awai-pc.patch` | `bb54d99ebf22eb3e5e2dcb8fb09e36f3845d43be84978eecbbb8a7eec9a50297` |
| `virtio-userdata-block-checkpoint.patch` | `36900715c29cb8e7a7b4d8c168d9900fc2ed3c7835bb0ff6b25634a49a7dde1d` |
| `virtio-userdata-ext4-checkpoint-wait.patch` | `bbe964dd61d84e514ec0d0133b101092b4cc4b5382b2fe26b9dfed1b72b10d48` |
| `virtio-userdata-ext4-checkpoint.patch` | `755884f70760bd87d7a5429d76cfaf33bf868658c6ed177b3758dad342bd69f3` |
| `virtio-userdata.patch` | `5d1b04ed6f461b568e714f9494fbf78d0efc114cf6b50f897d43d1bd4201000f` |
| `virtio-x86-64-awai-radeon-default.patch` | `30d235e7c1438702af1ed0291bd421d7acb571f44edc6577bd38ef42ebf2d244` |
| `virtio-x86-64-awai-radeon.patch` | `eb7b32c4fbb194387d5c1ce36c4d07a71eaf5e637a8ba105de80749d0ce1bf55` |
| `target-files/mkbootimg-header-version.patch` | `3b2116867b8841f5c5e7ffee2fee5e6116c2350db1f596f15c436e0ef23525fc` |
| `same-build/inputs/setupwizard-awai.patch` | `231d1ce2beb32785cbae4e53646f7ed234c6c8afd58131a1b38d7a695a159c90` |

## Reproduce

```sh
# From the awai-os worktree at 3f24b5bf:
shasum -a 256 android/desktop/manifest/pinned-manifest.xml
# 61c11f507fa14329229c16a635890b2c6d5f2f4e5a648a77045a09f7f4194d7d

# For each (project, path) in "Fetched files", with <sha> = the
# pinned revision of that project and <repo> = LineageOS/android_*:
curl -fsSL "https://raw.githubusercontent.com/<repo>/<sha>/<path>" -o <scratch>/<project>/<path>
shasum -a 256 <scratch>/<project>/<path>   # must match the table

# Per patch (pristine, fresh copy of that project's files):
git init <scratch>/<project>
git -C <scratch>/<project> apply --check -p1 android/desktop/pc-ab-device/patches/<patch>
# Updater patches add --unidiff-zero, before -p1.
# Record rc: 0 = applies, 1 = not applicable.

# Ordered apply for virtio-common (chosen variant selection):
git -C <d> apply -p1 patches/virtio-common-awai-pc.patch
git -C <d> apply -p1 patches/virtio-common-aw-mesa-sphal.patch
# attempt --reverse --check on virtio-userdata-ext4-checkpoint-wait.patch (fails),
# then for virtio-userdata.patch and virtio-userdata-block-checkpoint.patch
# in that order: reverse-check (both fail) then check -> first that checks is
# virtio-userdata-block-checkpoint.patch (rc=0) -> git apply it.
# Then: git apply --check -p1 patches/virtio-userdata-ext4-checkpoint.patch  # rc=1 (content already present)
#       git apply --reverse --check patches/virtio-userdata-ext4-checkpoint.patch  # rc=0 (apply.sh skips it)
#       git apply --check -p1 patches/virtio-userdata-ext4-checkpoint-wait.patch  # rc=0

# Full apply.sh on a tree of per-project git repositories
# (device/virt/virtio-common + device/virt/virt-common + vendor/lineage):
bash android/desktop/pc-ab-device/apply.sh <src>   # first run rc=0
bash android/desktop/pc-ab-device/apply.sh <src>   # second run rc=0 (idempotent)
```

Claim ceiling: no build, no boot, no reproducibility claim. Inputs
are fixed; patches are checked for applicability at the pinned
revisions only. No VKE/billing/device action taken.
