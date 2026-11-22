# Same-snapshot Awai Android build (AWAI-3850)

Builds `lamu` (moto g05) and `Generic_x86_64` (7735HS PC) from one pinned
LineageOS `lineage-24.0` checkout so both devices run the same Awai Android OS
generation. Owner decisions, 2026-11-22: VKE on-demand builder; moto is backed
up then wiped for a clean install; the PC gets a persistent NVMe install only
after its target partition is decided and the existing Nix install is proven
preserved — no PC disk write happens in this kit.

## Identity definition

Two installs are "the same OS" when all of these match; device-specific
kernel, DTB, vendor and firmware blobs are excluded by definition:

- `pinned-manifest.xml` SHA-256 from `repo manifest -r` (recorded in B2)
- Android 17 / API 37 (`build-prop-*.txt` in the artifact bundle)
- the Awai SetupWizard patch (`inputs/`, patch SHA-256
  `231d1ce2beb32785cbae4e53646f7ed234c6c8afd58131a1b38d7a695a159c90`)
- development testkey signing on both targets (not production signing)
- same Awai app versions installed afterwards (Home / Store / Yotei)
- locale `ja-JP`, timezone `Asia/Tokyo`

## Run

```sh
cd scripts/operator
export VULTR_API_KEY="$(security find-generic-password -s vultr-awai-build -a awai -w)"
export AWAI_SAME_BUILD_OUT=/path/to/new-evidence-dir
node vke-release-pool.mjs run \
  /Users/junkawasaki/github/workspaces/claude/awai-3542-tatara-runner/kubeconfig \
  -- bash same-build/workflow.sh
unset VULTR_API_KEY
```

The pool wrapper creates one paid node, runs the workflow, and always
releases the pool (strict teardown needs both Jobs complete; anything else
aborts and deletes the run's Jobs). The build Job syncs Lineage, applies the
wizard and mkbootimg inputs, builds `otapackage` for lamu and
`target-files-package otatools liveisoimage` for Generic, then uploads
`artifacts.tar.zst` + `manifest.json` to
`b2://awai-os-release-artifacts/awai-same-build/<pool>/`. The restore Job
re-downloads and verifies every digest. The Mac keeps only logs and the
manifest in `$AWAI_SAME_BUILD_OUT`.

## After the build

1. moto: flash `lamu-images.tar` / sideload `lamu-ota.zip` with the bootloader
   unlocked, wipe, boot, verify `sys.boot_completed=1`, then compare props
   and app versions against the acceptance table in AWAI-3850.
2. PC: regenerate the PXE bundle from `generic-live.iso` / target-files for
   live verification first. The NVMe install waits for the target decision.
3. Install the same Awai APK build on both and record versionName/versionCode.
