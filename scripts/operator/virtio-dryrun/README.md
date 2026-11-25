# lineage_virtio_x86_64 Job (AWAI-4089 G2)

Dry-run by default; executes for real only when
`BILLING_ALLOWED=1` **and** `OWNER_APPROVED=1`.

- `DRY_RUN=1` (default): `build-inside.sh` and `virtio-job.sh` print
  the exact command list; `repo sync` is printed, never run. Nothing
  is created against a cluster or a paid API in any mode.
- Approved mode (`BILLING_ALLOWED=1 OWNER_APPROVED=1`):
  `build-inside.sh` executes the same command list (no `[dry-run]`
  prefix): toolchain install, kit fetch (SHA-verified), `repo init` /
  `repo sync -m default.xml --no-manifest-update`, `repo manifest -r`
  full 1264-revision comparison, the repo's own apply tools
  (`apply.sh`, `apply-shipping-debug-lockdown.sh`, `pc-firmware.py
  prepare`, `updater-feed.py configure-release`), `breakfast
  lineage_virtio_x86_64 $RELEASE_TYPE`, v1 build + B2 upload,
  v2 rebuild, full + incremental OTA via `ota_from_target_files`,
  manifest.json/SHA256SUMS collection, B2 upload, and restore
  verification. Stage timestamps (`AWAI4089_STAGE=`) are printed for
  the next estimate.
- Refusals: no mode (exit 2); billing without owner; owner without
  billing; missing/!valid `RELEASE_TYPE`; deadline < 28800; missing
  `AWAI_FEED_URL` (required in all modes); in approved mode: missing
  `KIT_URL`/`KIT_SHA256`; kit tarball SHA mismatch; pinned manifest
  SHA mismatch (exit 1).

## Usage

```sh
# dry-run (prints only)
DRY_RUN=1 RELEASE_TYPE=userdebug AWAI_FEED_URL=https://feed.example/ota.json \
  bash scripts/operator/virtio-dryrun/build-inside.sh

# print the Job
DRY_RUN=1 RELEASE_TYPE=userdebug AWAI_VKE_NODE_POOL=awai-pc-release-012345abcdef \
  bash scripts/operator/virtio-dryrun/virtio-job.sh > /tmp/job.json

# approved execution (needs an owner-approved billing decision)
BILLING_ALLOWED=1 OWNER_APPROVED=1 RELEASE_TYPE=userdebug \
  KIT_URL=https://…/kit.tar.gz KIT_SHA256=<sha256> \
  AWAI_FEED_URL=https://feed.example/ota.json \
  bash scripts/operator/virtio-dryrun/build-inside.sh
```

`KIT_URL`/`KIT_SHA256`: kit tarball built by
`scripts/operator/virtio-dryrun/make-kit.sh <commit>` (`git archive`).
Contents: `scripts/operator/virtio-dryrun/`,
`android/desktop/manifest/pinned-manifest.xml`, `pc-ab-device/patches/`
(all repo patches) and the five apply tools (`apply.sh`,
`apply-shipping-debug-lockdown.sh`, `pc-firmware.py`, `updater-feed.py`,
`make-tf-disk.sh`), plus `scripts/operator/same-build/inputs/`
(`setupwizard-awai.patch`, `res/`, `setup-logo.png`) — evidence/
installer subdirectories are excluded. The Job command fetches the kit,
verifies its SHA-256, extracts it, and runs the extracted kit's
`build-inside.sh` (see `virtio-job.sh`; the script's own fetch is a
fallback for direct invocation). The kit SHA and the pinned manifest
SHA are both verified before use. `RELEASE_TYPE` is one of
`user`/`userdebug` and has no default — see `release-type.md` for the
userdebug-first proposal.

Patches are applied through the repository's own apply paths
(`pc-ab-device/apply.sh`, the lockdown script, `pc-firmware.py`),
never a hardcoded list, so patches merged to main later (e.g.
AWAI-4092 Wi-Fi or AWAI-4093 diagnostics) are included automatically.
At run time `AWAI4089_PATCH_COUNT` records the total: all of
`pc-ab-device/patches/*.patch` plus the single SetupWizard patch
(which ships outside `pc-ab-device/`). The SetupWizard patch
(`setupwizard-awai.patch` at the pinned `packages/apps/SetupWizard`
`1d158e23` tree) and its `res/`/`setup-logo.png` are applied before
`breakfast`/`m`; only one SetupWizard patch ships, so it applies
exactly once (the removed #510 stats patch would collide on the same
lines and cannot double-apply). No head is frozen: when #510/#511
land, regenerate the kit from the new head and re-run the same
approved test.

Kernel config regeneration is NOT a separate step in this Job. The
AOSP build merges `TARGET_KERNEL_CONFIG_EXT` (`KERNEL_DEFCONFIG_EXT`,
vendor/lineage@5a1814d9… `build/tasks/kernel.mk` line 116) and runs
olddefconfig itself (same file, lines 309–334, via
`internal-make-kernel-target`/`make-kernel-target`), with the
ARCH/CROSS_COMPILE/O the build needs. A separate `make -C ...
olddefconfig` would produce a different `.config` than the build
uses, so the Job never runs it. Flow: patch → (`m` merges config +
runs olddefconfig) → `m`. 4092's kernel config enters via
`device/virt/virtio-common/configs/kernel/*.config`
(`TARGET_KERNEL_CONFIG_EXT`), not a Job-side step.

Firmware input is the existing `FIRMWARE_GIT` (kernel.org
linux-firmware at `a2dcb924`, the same REVISION `pc-firmware.py`
pins); 4092's `rtw89/rtw8851b_fw` (.bin/-1.bin) enters the same input
via `pc-firmware.py`'s `FIRMWARE` — no new input. kernel.org serves
no filtered clone, so the fetch is bounded by `timeout 20m` (no
low-speed abort); the Job's 8 h deadline covers it.

## Tests

```sh
node --test scripts/operator/virtio-dryrun/virtio-dryrun.test.mjs
```

Offline: fake `repo`, `git`, `timeout`, `rclone`, `apt-get`, `curl`,
`ota_from_target_files` (plus `apply.sh`, `apply-shipping-debug-
lockdown.sh`, `pc-firmware.py`, `updater-feed.py`, `make-tf-disk.sh`
kit stubs, plus a fake `build/envsetup.sh` defining `breakfast`/`m` as
shell functions) record argv to a log; both modes are driven and the
full ordered argv list is asserted (dry-run executes nothing; approved
executes all) together with every refusal above, `-m default.xml`,
`path or name` + notdefault keys, and the two OTA commands. The
kit end-to-end test builds a real kit with `make-kit.sh <commit>`
(`git archive`), checks its trimmed contents, generates the approved
Job, and runs the Job command itself from an empty directory
(fetch → verify → extract → extracted `build-inside.sh` to restore),
asserting the runtime patch count matches the kit's `.patch` files.

Claim ceiling: dry-run evidence only unless the approval gate is
explicitly met. No build has run, no OTA is claimed.
