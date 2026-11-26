# lineage_virtio_x86_64 Job (AWAI-4089 G2)

> **The owner selected gad first for this candidate.** Wait for the
> gad free-space decision in Organizer item 211 and an approved build
> procedure for that host. The VKE Job renderer is for VKE.

The **procedure** (`build-inside.sh`: breakfast, JDK,
ROOMSERVICE_DRYRUN, ccache, patch application, target-files/disk/OTA
chain) takes its inputs as environment variables
(`BUILD_WORK_DIR`, `RELEASE_TYPE`, `AWAI_POOL_LABEL`, `MANIFEST_FILE`,
 `FIRMWARE_GIT`, …). `virtio-job.sh` renders the VKE-specific node
selector, resources, Secret mounts and workspace volume. A gad procedure
must establish host tool, storage, credential and artifact handling on
gad. See `docs/otehon/g2-build-requirements.md`.

Dry-run by default; executes for real only when
`BILLING_ALLOWED=1` **and** `OWNER_APPROVED=1`.

- `DRY_RUN=1`: `build-inside.sh` prints the plan and `virtio-job.sh`
  renders Job JSON. A Job command rendered in dry-run mode exits
  before installing or fetching anything.
- Approved mode (`BILLING_ALLOWED=1 OWNER_APPROVED=1`):
  `build-inside.sh` executes the same command list (no `[dry-run]`
  prefix): toolchain install, kit fetch (SHA-verified), kit and APK
  preflight, `repo init` /
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
  `AWAI_FEED_URL` (required in all modes); no apps mode or both apps
  modes; `AWAI_WITHOUT_APPS=1` with `RELEASE_TYPE=user`; prebuilt apps
  mode with missing or invalid pins; in approved mode: missing
  kit or output settings, kit digest mismatch, pinned manifest mismatch,
  missing APK or verifier, file digest mismatch, signature failure or an
  unexpected signer. Approved `user` also requires the Home/Store
  product integration and apply path in the kit. These failures stop
  before `repo init` and `repo sync`.

## Apps mode and APK inputs

| Mode | Job inputs |
| --- | --- |
| Evaluation | `AWAI_WITHOUT_APPS=1` with `RELEASE_TYPE=userdebug`. |
| Prebuilt | `AWAI_APK_STAGE` and all four digests below, with `RELEASE_TYPE=user` or `userdebug`. |

The app release producers supply signed, x86_64-compatible Home
(`network.awai.home`) and Store (`network.awai.store`) APKs and the
SHA-256 of the exact files. The owner or designated signing authority
approves each expected public X.509 certificate fingerprint through a
separate trusted channel. The operator checks app identity and version and
records all four pins in the run inputs. Obtain the expected fingerprints
from the trusted channel before staging the APKs.

| Input | Value |
| --- | --- |
| `AWAI_APK_STAGE` | Stage ID in the existing private B2 bucket `awai-os-release-artifacts`. The object keys are `awai-virtio-g2-inputs/<stage>/AwaiHome.apk` and `awai-virtio-g2-inputs/<stage>/AwaiStore.apk`. Use a dedicated ID with up to 63 lowercase ASCII letters, digits and hyphens, starting with a letter or digit. |
| `AWAI_HOME_APK_SHA256`, `AWAI_STORE_APK_SHA256` | Approved file SHA-256 for Home and Store, respectively. |
| `AWAI_HOME_EXPECTED_SIGNER_SHA256`, `AWAI_STORE_EXPECTED_SIGNER_SHA256` | Independently approved public certificate SHA-256 for Home and Store. Each pin is 64 lowercase hexadecimal characters. |
| `release-apk-stage-b2` | Required only for staged prebuilt mode. Supply it through the approved Secret path in namespace `awai-pc-release-build`. Use the same three keys as `release-artifacts-b2`: `RCLONE_CONFIG_ART_TYPE=b2`, `RCLONE_CONFIG_ART_ACCOUNT`, and `RCLONE_CONFIG_ART_KEY`. Scope the separate credential to read/list for the input stage prefix and the bucket discovery required by rclone. The Job mounts it read-only at `/run/secrets/awai-apk-stage`. Keep credential values and any signed URL out of shared output, PRs, the source tree and the kit. |

The worker installs Ubuntu Noble’s `apksigner=31.0.2-1ubuntu1` for staged
inputs. It snapshots both APKs into a private directory under
`BUILD_WORK_DIR`, checks each file SHA-256, and runs
`apksigner verify --print-certs` to require a valid signature and exactly
one approved signer per APK. `AWAI4094_APPS` records the mode and expected
fingerprints. `AWAI4094_APK_VERIFIED` records each successful check. Direct
`build-inside.sh` invocation can use absolute local `AWAI_HOME_APK`,
`AWAI_STORE_APK`, and `AWAI_APKSIGNER` paths with the same four pins
and no stage ID. Dry-run plans these checks without accessing the APKs.

Before `m`, the worker copies the verified snapshots to
`device/virt/virtio-common/awai-apps/{AwaiHome,AwaiStore}.apk` and exports
the verifier and expected signer pins to the build. The worker clears the
unverified-APK escape. The product include and its second fail-closed guard
are in [#523](https://github.com/network-awai/awai-os/pull/523). A shipping
candidate requires a kit revision with the landed product integration. The
`user` preflight checks the kit's project-relative app patch, product include,
presigned prebuilt modules, signer gate and `apply.sh` wiring before checkout.
After `apply.sh`, Git checks that the product patch is present in the
source tree before the build. When
a new arm64 or TV Job is defined, require the same explicit choice of apps
mode, source and pins and record the mode before building.

## Render the Job

```sh
# dry-run (prints only); apps mode is required
DRY_RUN=1 RELEASE_TYPE=userdebug AWAI_WITHOUT_APPS=1 \
  AWAI_FEED_URL=https://feed.example/ota.json \
  bash scripts/operator/virtio-dryrun/build-inside.sh

DRY_RUN=1 RELEASE_TYPE=user \
  AWAI_VKE_NODE_POOL="$POOL" AWAI_POOL_LABEL="$RUN_LABEL" \
  AWAI_FEED_URL="$FEED_URL" KIT_URL="$KIT_LOCATION" KIT_SHA256="$KIT_DIGEST" \
  AWAI_APK_STAGE="$STAGE_ID" \
  AWAI_HOME_APK_SHA256="$HOME_FILE_SHA256" AWAI_STORE_APK_SHA256="$STORE_FILE_SHA256" \
  AWAI_HOME_EXPECTED_SIGNER_SHA256="$HOME_CERT_SHA256" \
  AWAI_STORE_EXPECTED_SIGNER_SHA256="$STORE_CERT_SHA256" \
  bash scripts/operator/virtio-dryrun/virtio-job.sh > /tmp/job.json
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

Build environment (vs ab-build.sh / ab-ota.sh / same-build):
- `breakfast virtio_x86_64 "$RELEASE_TYPE"` (Rule: pinned
  vendor/lineage `5a1814d9` `build/envsetup.sh` maps `breakfast
  <target> [variant]` to `lunch lineage_<target>-<release>-<variant>`
  unless the target already ends in `-user/-userdebug/-eng`; the
  `lineage_lineage_…` form is invalid).
- 52Gi memory (same-build lowers 64Gi to 52Gi for vc2-16c-64gb).
- Prebuilt JDK 21 on PATH (`$SRC/prebuilts/jdk/jdk21/linux-x86/bin`,
  needed by ota_from_target_files; ab-ota.sh line 24) plus
  `openjdk-21-jdk-headless` in the apt list; `ROOMSERVICE_DRYRUN=true`
  exported before breakfast (ab-build.sh line 5); ccache enabled
  (ab-build.sh line 4, ephemeral dir).
- `-e` is kept: the Job has no polling loops, expected failures are
  guarded, and breakfast/m must fail loud; the A/B scripts' `-e`-less
  form serves their grep-polling. It is unverified that
  `source build/envsetup.sh` and `breakfast` work under `set -e` —
  this remains unproven until a real build confirms it. `/root/.cargo/bin` is not added: Rust
  for the build comes from the source-prebuilt (pinned vendor
  envsetup.sh reads `RUST_VERSION` from
  `build/soong/rust/config/global.go`), not cargo.
- The 11-19 kernel need beyond the pinned tree is only the
  `kernel/virt/virtio` source presence (branch virtio/android17-6.18,
  ota-reference README); the pinned manifest already pins it, and the
  4092 kernel config enters via `TARGET_KERNEL_CONFIG_EXT`. No other
  picked-change record exists in the repo.

## Before starting a user/prebuilt candidate

- For this candidate, use the gad-first route once Organizer item 211
  confirms free space and the owner approves execution. Confirm the gad
  host’s capacity, Linux/amd64 toolchain, storage and credentials. Use
  `BILLING_ALLOWED=1` and `OWNER_APPROVED=1` only after approval.
- The reference VKE Job’s amd64 pool selector and taint must match its
  node, tools and sources must be reachable, and the node must meet the 14 CPU,
  52Gi RAM, 520Gi ephemeral-storage request and 8 h minimum deadline
  (`AWAI_VIRTIO_DEADLINE_SECONDS`, default and minimum 28800).
  The workspace has a 700Gi ephemeral volume limit.
- Record the full Awai OS commit with the Home/Store product integration,
  the kit SHA-256, and the manifest SHA-256 enforced by the script
  (`61c11f507fa14329229c16a635890b2c6d5f2f4e5a648a77045a09f7f4194d7d`).
  Retain the resolved manifest, pinned container and firmware revisions,
  both APK file/signer pins, and the credential-free `AWAI_FEED_URL`.
  Keep a rendered Job containing a private kit URL in the operator environment.
- Confirm access to the approved input and output storage. For the VKE
  reference Job, confirm the existing private B2 stage and output bucket
  using their respective Secret scopes. It uses `release-artifacts-b2`
  and a fresh `AWAI_POOL_LABEL` for
  `awai-os-release-artifacts/awai-virtio-g2/<label>/`. G2 uploads the v1
  unsigned target-files first to `v1/virtio-target-files-v1.zip`, preserves
  v2 unsigned `virtio-target-files.zip` at the root, and restores its
  output ledger. The G2 disk and test-key OTAs are evaluation outputs.
- Arrange retention and independent readback of the selected version’s
  unsigned target-files, original stock
  `$SRC/out/target/product/virtio_x86_64/disk-vda.img` and matching Linux
  host tools (`$SRC/out/host/linux-x86` or a verified tools archive) before
  the workspace disappears. Collect the original stock disk and host tools
  separately from the G2 upload. Record sizes, SHA-256 and build provenance.
  See the [release artifact contract](../../../docs/otehon/pc-release-build-vke.md#preserve-and-restore-the-current-release).

### Qualification after the build

1. With the recorded unsigned SHA-256, run
   [`prepare-target-files.py`](../../../android/release-signing/README.md#stage-the-unsigned-archive-before-local-signing)
   on the build host. On the approved Mac, the owner checks the prepared
   hash and runs the matching AOSP `sign_target_files_apks` workflow with
   the approved APK/APEX/AVB key plan, preserving the Home/Store presigned
   inputs. Run the public-certificate checks in the signing guide and
   retain the signed target-files SHA-256 and signing receipt.
2. On Linux, assemble a new disk using that signed ZIP, the same build’s
   stock disk and host tools. Pass both recorded hashes to
   [`make-tf-disk.sh`](../../../android/desktop/pc-ab-device/install-media.md).
   Keep its readback log and the installation image hash.
3. Qualify the verified candidate on a disposable x86_64 KVM/OVMF guest
   with one virtual NVMe disk, fresh userdata, and the shipping debug policy.
   Use [`pc-ab-device/kvm/nvme-kvm.sh`](../../../android/desktop/pc-ab-device/kvm/nvme-kvm.sh)
   as a QEMU reference. Its `prepare` path enables insecure ADB for
   userdebug evidence. Keep the shipping image’s debug policy intact.
   Record first setup, Home as the default after setup and reboot, Store launch,
   installed APK provenance and shipping debug lockdown. For A/B acceptance,
   follow the [target-files and OTA verification commands](../../../android/desktop/pc-ab-device/README.md#updater-feed-in-the-release-build-awai-3064)
   and [OTA reference sequence](../../../android/desktop/ota-reference-check/README.md)
   for full, incremental, refusal and recovery with the exact signed input
   versions. Record VM and physical acceptance separately.

Live input and output storage access, approved Job execution, owner signing,
media assembly, VM acceptance and physical acceptance of this candidate remain
unmeasured.

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
`path or name` + notdefault keys, and the two OTA commands. The staged user
fixture checks that missing objects, wrong file SHA-256, invalid or unexpected
signatures, additional signers and a missing Secret never reach source work.
It also rejects kits missing the product patch or its apply route. The positive
fixture applies the product patch to a small source tree with real Git.
It also changes a staged file after download and verifies that the build
receives the checked snapshot. The local-input fixture checks a missing verifier.
Storage, apksigner and the build are stubbed. The
kit end-to-end test builds a real kit with `make-kit.sh <commit>`
(`git archive`), checks its trimmed contents, generates the approved
Job, and runs the Job command itself from an empty directory
(fetch → verify → extract → extracted `build-inside.sh` to restore),
asserting the runtime patch count matches the kit's `.patch` files.

Claim ceiling: dry-run evidence only unless the approval gate is
explicitly met. No build has run, no OTA is claimed.
