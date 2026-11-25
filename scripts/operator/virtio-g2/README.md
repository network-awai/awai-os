# G2 lineage_virtio_x86_64 Job (AWAI-4088, dry-run only)

One Job definition for the Desktop product **`lineage_virtio_x86_64`**:
from the pinned manifest it builds **target-files → install image → full
OTA → incremental OTA** in sequence, as a single Job run. This directory is
new and disjoint from the AWAI-3850 lamu / Generic_x86_64 Job
(`scripts/operator/same-build/`): different product, scripts, B2 prefix
(`awai-virtio-g2/<pool>/` vs `awai-same-build/<pool>/`), and artifact names
(`virtio-*` vs `lamu-*` / `generic-*`). The same-build Job is untouched.

**Status: definition only. No run was made (no VKE, no sync, no build).**
`digests.json` has empty slots for every artifact digest.

## Inputs (explicit)

| Input | Value |
| --- | --- |
| Pinned manifest | `android/desktop/manifest/pinned-manifest.xml`, SHA-256 `61c11f507fa14329229c16a635890b2c6d5f2f4e5a648a77045a09f7f4194d7d` (verified in-Job before sync; from `manifest-inputs.sha256`) |
| Manifest repo (init base only) | `https://github.com/LineageOS/android.git`, branch `lineage-24.0` |
| Product | `lineage_virtio_x86_64` |
| Release type | `user` (env `VARIANT`; `userdebug` for dev runs). Default is `user`. |
| PC patches | `android/desktop/pc-ab-device/` applied via `apply.sh` (select/skip logic included). Updater patches excluded: measured NOT APPLICABLE at this snapshot (see evidence below). |
| mkbootimg patch | `android/desktop/target-files/mkbootimg-header-version.patch` is out of scope for virtio (BOARD_BOOT_HEADER_VERSION not used in this tree). Guard mirrors `build-inside.sh` and skips. |
| Signing keys | AOSP test key (`build/make/target/product/security/testkey`), dev only — same ceiling as AWAI-3850. Not a production release. |
| Build image | `ubuntu@sha256:9a04f13b3f80ef056361e30868593b1cfd2279fe19e4081cb93a90bf56819d6a` (same pinned image as same-build) |
| Output (B2) | `awai-virtio-g2/<pool>/` (new prefix; never `awai-same-build/`). Local evidence dir must be a fresh `$AWAI_G2_OUT` (workflow `mkdir -m 700 -p` on that path only). |

## Chain (single input tree)

1. Verify pinned-manifest SHA-256, `repo init`, install the pinned
   manifest as `.repo/manifests/default.xml`, `repo sync`, re-export
   `pinned-manifest.xml` + `source-revisions.txt`.
2. Apply patches (`pc-ab-device/apply.sh` + mkbootimg guard).
3. `breakfast lineage_virtio_x86_64 $VARIANT`.
4. v1: `m target-files-package otatools diskimage-vda` (target-files +
   install-image source) → keep `virtio-target-files-v1.zip`.
5. v2: rebuild `target-files-package` with a new `BUILD_NUMBER`/`BUILD_DATETIME`
   from the same tree (incremental-OTA target). Pattern matches
   `android/desktop/ota-reference-check/ab-ota.sh`.
6. Install image: `diskimage-vda` output → `virtio-install-image.img`.
7. Full OTA: `ota_from_target_files -k testkey <v2> virtio-full-ota.zip`.
8. Incremental OTA: `ota_from_target_files -k testkey -i <v1> <v2> virtio-incremental-ota.zip`.
9. Collect: `SHA256SUMS` + `manifest.json` (path/size/SHA-256 per object) → B2.

## Dry-run (only path exercised by this PR)

```sh
bash scripts/operator/virtio-g2/workflow-virtio-g2.sh --dry-run
AWAI_G2_DRY_RUN=1 bash scripts/operator/virtio-g2/build-virtio-g2.sh
```

Both print the step list and exit 0; no cluster access, no sync, no build.

## Patch applicability at this snapshot

Measured free of charge (single-project shallow fetches at pinned SHAs,
`git apply --check`): see
[`android/desktop/evidence/g2-patches-20261125/`](../../android/desktop/evidence/g2-patches-20261125/README.md)
— 18 patches: **11 pass pristine, 2 more pass in the `apply.sh` chain
(13 applicable), 5 not applicable, 0 unmeasured**; plus the `mkbootimg`
patch explicitly out of scope (対象外, BOARD_BOOT_HEADER_VERSION not used).

## Digest slots

[`digests.json`](digests.json) (schema `awai.g2-digests.v1`) has one slot
each for `manifest`, `targetFiles`, `installImage`, `fullOta`,
`incrementalOta` (SHA-256 + bytes). Values stay empty until a run fills
them from read-back `SHA256SUMS` / `manifest.json` — never invented.
