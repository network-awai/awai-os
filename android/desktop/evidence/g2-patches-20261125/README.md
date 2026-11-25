# G2 patch applicability (no-build, no-charge measurement)

Measured 2026-11-25T02:05–02:07Z against the pinned manifest from
`android/desktop/manifest/pinned-manifest.xml` (1264 projects, G1 / PR #503;
`manifest-inputs.sha256` entry `61c11f5…`) at `3f24b5bf`.
No `repo sync`, no `m`, no VKE. Each target project was fetched alone
(`git init` + `git fetch --depth 1 origin <pinned SHA>` + checkout, no
`repo`), then `git apply --check` was run against that pristine tree.
Raw commands and outputs are under `raw/`.

Scope: the 18 patches under `android/desktop/pc-ab-device/patches/`, plus
`android/desktop/target-files/mkbootimg-header-version.patch` as an explicit
row. The scratch clones lived outside the repo
(`/Users/node/.hermes/cache/scratch/g2-20261125/src/`); checkouts were
restored pristine (`git reset --hard` + `git clean -fd`) after the chain
probes, so every `git apply --check` below ran against the pinned SHA.

## Fetch (7 target projects)

Total wall time for all 7 fetches: 2026-11-25 02:05:5x–02:06:09Z (~14 s).
Per-project (fetch + checkout, `git fetch --depth 1 origin <SHA>`):

| Project (path in tree) | Remote repo | Pinned revision | Verified HEAD | Time |
| --- | --- | --- | --- | --- |
| `build/make` | `LineageOS/android_build` | `90d006387398ae6899145e6531a304500cfa0f70` | match | 3 s |
| `device/mainline/common` | `LineageOS/android_device_mainline_common` | `e237088ec3475c6b93e7148bdcc32218e36f782f` | match | 1 s |
| `packages/apps/Updater` | `LineageOS/android_packages_apps_Updater` | `1445c6104ffb33123d4e449a60e3c054ed5a9ee0` | match | 1 s |
| `vendor/lineage` | `LineageOS/android_vendor_lineage` | `5a1814d916321aecb72d60d13b5e52bc719251bd` | match | 3 s |
| `device/virt/virt-common` | `LineageOS/android_device_virt_virt-common` | `5da818292d9a66cf282e909287fdab14eb80711b` | match | 1 s |
| `device/virt/virtio-common` | `LineageOS/android_device_virt_virtio-common` | `9d5c9307434bba31d19030fcc61086efcd248997` | match | 1 s |
| `device/virt/virtio_x86_64` | `LineageOS/android_device_virt_virtio_x86_64` | `0e8571a0d7fce749856e9dea72e99a8a83f8f9b4` | match | 0 s |

`repo sync` was not run. Full log: `raw/fetch.log`.

## Patch applicability

Verdict levels (both columns are measured, never mixed):

- **pristine** = `git -C <checkout> apply --check <patch>` against the
  untouched pinned SHA.
- **chain** = the same check, after applying the documented prerequisites
  in `android/desktop/pc-ab-device/apply.sh` order, for the projects whose
  patches stack (`virtio-common`, `Updater`, `virtio_x86_64`). See
  `raw/chains.txt` for every step and exit code.
- **適用** = pristine passes. **適用（連鎖）** = pristine fails but the
  `apply.sh`-ordered chain passes. **不適用** = both fail (reason given).
  **未測定** = could not be measured (fetch failure / target not in
  manifest). **対象外** = excluded by instruction, not measured.

| # | Patch | Target project | Revision | Patch SHA-256 | Bytes | pristine | chain | Verdict | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `android/desktop/pc-ab-device/patches/build-no-trade-in-mode-trigger.patch` | `build/make` | `90d006387398ae6899145e6531a304500cfa0f70` | `bd6b765d9ddbae857525c1778dfe286fd01f52f824e031f565babc40a52575b1` | 388 | PASS | — | 適用 | — |
| 2 | `android/desktop/pc-ab-device/patches/mainline-common-user-no-insecure-debugging.patch` | `device/mainline/common` | `e237088ec3475c6b93e7148bdcc32218e36f782f` | `1fe48fe0027594796b8a99d4e367e3b8c6d53c0265e8a6483b37c7bbaa74436e` | 1387 | PASS | — | 適用 | — |
| 3 | `android/desktop/pc-ab-device/patches/updater-empty-feed-withdrawal.patch` | `packages/apps/Updater` | `1445c6104ffb33123d4e449a60e3c054ed5a9ee0` | `1cdb1b49fc0bcfd553a886d58f98f7fd2952be034d2527575fcb11077b01ff35` | 1080 | FAIL `UpdatesRepository.kt:60` | FAIL (after serialize attempt; reverse also fails) | 不適用 | pinned `1445c61` に対して patch base が drift（reverse でも適用不可＝既適用ではない） |
| 4 | `android/desktop/pc-ab-device/patches/updater-pc-maintenance.patch` | `packages/apps/Updater` | `1445c6104ffb33123d4e449a60e3c054ed5a9ee0` | `600b2685208ab2cf0305cf763eeb772e2c44cb2d71ed3bb9f7778785cba0a9b2` | 23867 | FAIL (5 hunks: `ABUpdateInstaller.java:48`, `UpdatesRepository.kt:40`, `UpdatesCheckWorker.kt:36`, `UpdaterController.java:263`, `HttpURLConnectionClient.java:248`) | FAIL (reverse also fails; new files `PcMaintenance.kt` 等は既に無い) | 不適用 | 同上。連鎖（serialize→pc-maintenance）でも適用不可 |
| 5 | `android/desktop/pc-ab-device/patches/updater-serialize-ab-preparation.patch` | `packages/apps/Updater` | `1445c6104ffb33123d4e449a60e3c054ed5a9ee0` | `825a5e82ad4e09c9fd3410f2fe51f316f45c8cc13c55d5f02dfba28e3dd114e9` | 4438 | FAIL `ABUpdateInstaller.java:175` (`apply` 自体も失敗) | FAIL | 不適用 | 同上。pinned では `class ABUpdateInstaller {` が 36 行目（patch base では 48 行目）で drift |
| 6 | `android/desktop/pc-ab-device/patches/vendor-lineage-kernel-output-prefix.patch` | `vendor/lineage` | `5a1814d916321aecb72d60d13b5e52bc719251bd` | `7e3073b68f625c1d5b596ba85e7fa9f2cdc07b92b01fee34586362aaef04a033` | 440 | PASS | PASS after `vendor-lineage-no-ota-downgrade` | 適用 | — |
| 7 | `android/desktop/pc-ab-device/patches/vendor-lineage-no-ota-downgrade.patch` | `vendor/lineage` | `5a1814d916321aecb72d60d13b5e52bc719251bd` | `dc018af33da42827f1b9d21f16e44e99d5b4923009173eb7585658bea03d926d` | 357 | PASS | — | 適用 | — |
| 8 | `android/desktop/pc-ab-device/patches/virt-common-awai-boot-name.patch` | `device/virt/virt-common` | `5da818292d9a66cf282e909287fdab14eb80711b` | `ed9eacea16b97901f32aec688cf10a404490803b551e1b06b414a27036f98d60` | 649 | PASS | PASS after `virt-common-awai-pc` | 適用 | — |
| 9 | `android/desktop/pc-ab-device/patches/virt-common-awai-pc.patch` | `device/virt/virt-common` | `5da818292d9a66cf282e909287fdab14eb80711b` | `4a2b4adae8aa18b131a304c33c782c8829264a2968d6a63b0609b15c58867e83` | 4050 | PASS | — | 適用 | — |
| 10 | `android/desktop/pc-ab-device/patches/virt-common-user-no-adb-tcp.patch` | `device/virt/virt-common` | `5da818292d9a66cf282e909287fdab14eb80711b` | `7bcc960ab4565d4335d5ad51957d6fb5c63173fb732d17fb04f5ad511f174c39` | 817 | PASS | PASS after `virt-common-awai-pc` + `virt-common-awai-boot-name` | 適用 | — |
| 11 | `android/desktop/pc-ab-device/patches/virtio-common-aw-mesa-sphal.patch` | `device/virt/virtio-common` | `9d5c9307434bba31d19030fcc61086efcd248997` | `5e825c710eb39e94eaea9da326fb00723746296d3cbe03b613dc4b367ad232d9` | 446 | FAIL `sepolicy/vendor/file_contexts:17` | PASS after `virtio-common-awai-pc` | 適用（連鎖） | `apply.sh` の順（`virtio-common-awai-pc` → `virtio-common-aw-mesa-sphal`）では適用可能。直積のみでは当たらない |
| 12 | `android/desktop/pc-ab-device/patches/virtio-common-awai-pc.patch` | `device/virt/virtio-common` | `9d5c9307434bba31d19030fcc61086efcd248997` | `bb54d99ebf22eb3e5e2dcb8fb09e36f3845d43be84978eecbbb8a7eec9a50297` | 3040 | PASS | — | 適用 | — |
| 13 | `android/desktop/pc-ab-device/patches/virtio-userdata-block-checkpoint.patch` | `device/virt/virtio-common` | `9d5c9307434bba31d19030fcc61086efcd248997` | `36900715c29cb8e7a7b4d8c168d9900fc2ed3c7835bb0ff6b25634a49a7dde1d` | 1052 | PASS | PASS after `virtio-common-awai-pc` + `virtio-common-aw-mesa-sphal` | 適用 | fstab `checkpoint=block` の前の選択肢（`virtio-userdata` と対）として当たる |
| 14 | `android/desktop/pc-ab-device/patches/virtio-userdata-ext4-checkpoint-wait.patch` | `device/virt/virtio-common` | `9d5c9307434bba31d19030fcc61086efcd248997` | `bbe964dd61d84e514ec0d0133b101092b4cc4b5382b2fe26b9dfed1b72b10d48` | 791 | FAIL `configs/fstab/fstab.virtio-common:1` | PASS after `virtio-userdata-block-checkpoint` | 適用（連鎖） | `apply.sh` 連鎖（`virtio-userdata` または `block-checkpoint` → `wait`）では適用可能 |
| 15 | `android/desktop/pc-ab-device/patches/virtio-userdata-ext4-checkpoint.patch` | `device/virt/virtio-common` | `9d5c9307434bba31d19030fcc61086efcd248997` | `755884f70760bd87d7a5429d76cfaf33bf868658c6ed177b3758dad342bd69f3` | 851 | FAIL `configs/fstab/fstab.virtio-common:1` | forward FAIL after `block-checkpoint`; reverse PASS after `block-checkpoint` | 不適用 | `checkpoint=block` の効果は pinned tree（ext4 も f2fs も既に `checkpoint=block/fs`）+ `block-checkpoint` で既に満たされている。`apply.sh` の reverse-check skip 分岐に当たる |
| 16 | `android/desktop/pc-ab-device/patches/virtio-userdata.patch` | `device/virt/virtio-common` | `9d5c9307434bba31d19030fcc61086efcd248997` | `5d1b04ed6f461b568e714f9494fbf78d0efc114cf6b50f897d43d1bd4201000f` | 1048 | FAIL `configs/fstab/fstab.virtio-common:1` | FAIL after chain; reverse FAIL on pristine | 不適用 | pre-checkpoint fstab（`/dev/block/vdb` … `metadata_encryption` のみ）用の旧分岐代替。当 pinned では当て先が無い。`apply.sh` の `select_fstab_patch` はこの場合 `block-checkpoint` を選ぶ |
| 17 | `android/desktop/pc-ab-device/patches/virtio-x86-64-awai-radeon-default.patch` | `device/virt/virtio_x86_64` | `0e8571a0d7fce749856e9dea72e99a8a83f8f9b4` | `30d235e7c1438702af1ed0291bd421d7acb571f44edc6577bd38ef42ebf2d244` | 1050 | PASS | PASS both orders | 適用 | `grub-boot.cfg` を `virtio-x86-64-awai-radeon` と共有するが、どちらの順でも競合しない |
| 18 | `android/desktop/pc-ab-device/patches/virtio-x86-64-awai-radeon.patch` | `device/virt/virtio_x86_64` | `0e8571a0d7fce749856e9dea72e99a8a83f8f9b4` | `eb7b32c4fbb194387d5c1ce36c4d07a71eaf5e637a8ba105de80749d0ce1bf55` | 2561 | PASS | PASS both orders | 適用 | — |
| 19 | `android/desktop/target-files/mkbootimg-header-version.patch` | `device/mainline/generic` | `3d402dc58aa2086a960abd076204836259387a79` | `3b2116867b8841f5c5e7ffee2fee5e6116c2350db1f596f15c436e0ef23525fc` | 325 | 未測定（取得せず） | — | 不適用（対象外） | BOARD_BOOT_HEADER_VERSION を使わないツリーのため対象外（G1 README / `build-inside.sh` の `AWAI3850_GENERIC_FIX_SKIPPED` と同じ判断） |

Patch SHA-256 values above are computed from the repo files (`raw/patches.sha256`)
and are identical to `android/desktop/manifest/manifest-inputs.sha256`
(verified: `diff` empty).

## Counts

- Patch total in scope: 19 (18 in `pc-ab-device/patches/` + `mkbootimg-header-version.patch`).
- 適用（pristine passes）: 11 (#1, #2, #6, #7, #8, #9, #10, #12, #13, #17, #18).
- 適用（連鎖）: 2 (#11, #14) — total applicable: 13.
- 不適用: 5 (#3, #4, #5, #15, #16).
- 不適用（対象外）: 1 (#19, `mkbootimg`, `3d402dc`, BOARD_BOOT_HEADER_VERSION を使わないツリーのため対象外).
- 未測定: 0 — 7 target projects fetched and verified at their pinned SHAs,
  all 18 patches measured. No patch target is missing from the manifest,
  so the “not in manifest” 未測定 case did not occur.
- Target projects measured: 7. The `mkbootimg` target (`device/mainline/generic`,
  `3d402dc`) was not fetched, per the 対象外 rule.

## Not measured (unmeasured, by design)

- No build, no `repo sync`, no install-image generation, no OTA generation
  were run. `git apply` results above are the only build-adjacent claims.
- Whether the three 不適用 Updater patches could be rebased onto
  `1445c61` was not attempted (that would be a rebase, not a check).
- Whether `virtio-userdata` becomes applicable on an older base was not
  attempted; only the pinned `9d5c930` result is claimed.
- The G2 Job itself (companion change in this PR) was dry-run only and
  was not executed (no VKE).

## Files

- `README.md` — this table.
- `raw/fetch.log` — per-project `git init` / `fetch --depth 1` / checkout log.
- `raw/pristine.txt` — all 18 `git apply --check` runs against pristine
  checkouts (command, HEAD, patch SHA-256, exit code, output).
- `raw/chains.txt` — reverse-checks + `apply.sh`-ordered chain probes.
- `raw/patches.sha256` — `shasum -a 256` of all 18 patches (matches
  `manifest-inputs.sha256`).
- `SHA256SUMS` — digests for every file in this directory.
