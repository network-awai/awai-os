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

`KIT_URL`/`KIT_SHA256`: kit tarball (repo's `pc-ab-device/` +
`scripts/operator/virtio-dryrun/` + pinned manifest), operator-provided;
the kit SHA is verified before any use. `RELEASE_TYPE` is one of
`user`/`userdebug` and has no default — see `release-type.md` for the
userdebug-first proposal.

## Tests

```sh
node --test scripts/operator/virtio-dryrun/virtio-dryrun.test.mjs
```

Offline: fake `repo`, `git`, `m`, `rclone`, `apt-get`, `curl`,
`ota_from_target_files` (plus `apply.sh`, `apply-shipping-debug-
lockdown.sh`, `pc-firmware.py`, `updater-feed.py`, `make-tf-disk.sh`
kit stubs) record argv to a log; both modes are driven and the full
ordered argv list is asserted (dry-run executes nothing; approved
executes all) together with every refusal above, `-m default.xml`,
`path or name` + notdefault keys, and the two OTA commands.

Claim ceiling: dry-run evidence only unless the approval gate is
explicitly met. No build has run, no OTA is claimed.
