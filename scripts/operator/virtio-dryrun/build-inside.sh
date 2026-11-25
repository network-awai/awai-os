#!/usr/bin/env bash
# AWAI-4089 (G2): lineage_virtio_x86_64 dry-run build definition.
#
# Prints the exact steps a future paid build would run, against the
# G1 pinned manifest. DRY_RUN=1 is mandatory: without it the script
# refuses. Nothing here creates a node pool, runs access-control or
# workload tools, or calls a paid API: with DRY_RUN=1 the script only
# validates the pinned manifest input (read-only) and prints steps;
# repo sync is printed, never run.
#
# Env:
#   DRY_RUN=1              required
#   MANIFEST_FILE          pinned-manifest.xml to validate (default: the
#                          committed android/desktop/manifest copy)
#   SRC                    source root for --validate-against (default
#                          /root/build/src)
#   PATCH_DIR              directory of the Awai PC patches (default:
#                          the committed pc-ab-device/patches)
#
# Usage:
#   DRY_RUN=1 bash build-inside.sh
#   DRY_RUN=1 bash build-inside.sh --validate-against <src root>
# --validate-against runs real `git apply --check` (+ apply) for every
# Part-1-applicable patch against <src root>, in the repo's own apply
# order, aborting with AWAI4089_NOT_APPLICABLE at the first patch that
# does not apply. This is the hook the offline test uses to prove a
# non-applicable patch aborts; no other mode executes a build step.
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
repo_root=$(cd "$here/../../.." && pwd)
MANIFEST_FILE=${MANIFEST_FILE:-"$repo_root/android/desktop/manifest/pinned-manifest.xml"}
PATCH_DIR=${PATCH_DIR:-"$repo_root/android/desktop/pc-ab-device/patches"}
SRC=${SRC:-/root/build/src}
EXPECTED_MANIFEST_SHA256=61c11f507fa14329229c16a635890b2c6d5f2f4e5a648a77045a09f7f4194d7d

if [[ ${DRY_RUN:-} != 1 ]]; then
  echo "AWAI4089_REFUSES: DRY_RUN=1 is required; nothing to do without it." >&2
  exit 2
fi

# 0. Validate the pinned manifest input before anything else. The
# manifest is used as-is (never re-resolved); repo sync would consume
# it installed as .repo/manifests/default.xml, printed in step 2.
actual=$(shasum -a 256 "$MANIFEST_FILE" | awk '{print $1}')
if [[ $actual != "$EXPECTED_MANIFEST_SHA256" ]]; then
  echo "AWAI4089_REFUSES: pinned manifest SHA-256 differs: got $actual want $EXPECTED_MANIFEST_SHA256" >&2
  exit 1
fi
printf 'AWAI4089_MANIFEST_SHA256_VALIDATED %s %s\n' "$EXPECTED_MANIFEST_SHA256" "$MANIFEST_FILE"

# The Part-1-applicable set at the pinned SHAs, in the repo's apply
# order (patch-applicability-20261125.md). Each entry:
# <project path>|<patch file>|<extra git apply flags, space separated>.
APPLICABLE=(
  "device/virt/virtio-common|virtio-common-awai-pc.patch|"
  "device/virt/virtio-common|virtio-common-aw-mesa-sphal.patch|"
  "device/virt/virtio-common|virtio-userdata-block-checkpoint.patch|"
  "device/virt/virtio-common|virtio-userdata-ext4-checkpoint-wait.patch|"
  "device/virt/virt-common|virt-common-awai-pc.patch|"
  "device/virt/virt-common|virt-common-awai-boot-name.patch|"
  "device/virt/virt-common|virt-common-user-no-adb-tcp.patch|"
  "device/virt/virtio_x86_64|virtio-x86-64-awai-radeon.patch|"
  "device/virt/virtio_x86_64|virtio-x86-64-awai-radeon-default.patch|"
  "vendor/lineage|vendor-lineage-no-ota-downgrade.patch|"
  "vendor/lineage|vendor-lineage-kernel-output-prefix.patch|"
  "build/make|build-no-trade-in-mode-trigger.patch|"
  "device/mainline/common|mainline-common-user-no-insecure-debugging.patch|"
  "packages/apps/Updater|updater-empty-feed-withdrawal.patch|--unidiff-zero"
  "packages/apps/Updater|updater-serialize-ab-preparation.patch|--unidiff-zero"
  "packages/apps/Updater|updater-pc-maintenance.patch|--unidiff-zero"
)
# setupwizard-awai.patch lives with the same-build inputs, not in PATCH_DIR.
SETUPWIZARD="$repo_root/scripts/operator/same-build/inputs/setupwizard-awai.patch"

if [[ ${1:-} == --validate-against && -n ${2:-} ]]; then
  SRC=$2
  for entry in "${APPLICABLE[@]}"; do
    IFS='|' read -r proj patch flags <<< "$entry"
    dir="$SRC/$proj"
    [[ -d $dir ]] || { echo "AWAI4089_NOT_APPLICABLE: missing project would-be-at $dir for $patch" >&2; exit 1; }
    # shellcheck disable=SC2086
    if ! git -C "$dir" apply --check -p1 $flags "$PATCH_DIR/$patch"; then
      echo "AWAI4089_NOT_APPLICABLE: $patch does not apply at $proj (pinned source)" >&2
      exit 1
    fi
    # shellcheck disable=SC2086
    git -C "$dir" apply -p1 $flags "$PATCH_DIR/$patch"
  done
  git -C "$SRC/packages/apps/SetupWizard" apply --check -p1 "$SETUPWIZARD" ||
    { echo "AWAI4089_NOT_APPLICABLE: setupwizard-awai.patch does not apply at packages/apps/SetupWizard" >&2; exit 1; }
  git -C "$SRC/packages/apps/SetupWizard" apply -p1 "$SETUPWIZARD"
  echo "AWAI4089_VALIDATION_DONE"
  exit 0
fi

step() { printf '[dry-run] %s\n' "$*"; }

step "AWAI4089_DRY_RUN_BEGIN"
step "repo init -u https://github.com/LineageOS/android.git -b lineage-24.0 --no-clone-bundle   # cwd=$SRC"
step "install pinned manifest as-is: cp $MANIFEST_FILE $SRC/.repo/manifests/default.xml   # sha256 $EXPECTED_MANIFEST_SHA256"
step "NOT RUN: repo sync -c --no-clone-bundle --optimized-fetch -j\"(nproc)\"   # printed only; no sync happens under DRY_RUN"
step "source build/envsetup.sh"
step "breakfast lineage_virtio_x86_64 userdebug"

step "apply Part-1-applicable patches (git apply --check then git apply, in repo apply order)"
for entry in "${APPLICABLE[@]}"; do
  IFS='|' read -r proj patch flags <<< "$entry"
  step "git -C $SRC/$proj apply --check -p1 $flags $PATCH_DIR/$patch"
  step "git -C $SRC/$proj apply -p1 $flags $PATCH_DIR/$patch"
done
step "git -C $SRC/packages/apps/SetupWizard apply --check -p1 $SETUPWIZARD"
step "git -C $SRC/packages/apps/SetupWizard apply -p1 $SETUPWIZARD"
step "EXCLUDED mkbootimg-header-version.patch: not applicable at device/mainline/generic 3d402dc5 (no BOARD_BOOT_HEADER_VERSION)"
step "EXCLUDED virtio-userdata.patch: not chosen at pinned SHA (selection picks virtio-userdata-block-checkpoint.patch)"
step "EXCLUDED virtio-userdata-ext4-checkpoint.patch: obsoleted by chosen block variant; note apply.sh as written aborts at this step at the pinned SHA"
step "KNOWN-EVIDENCE scripts/operator/same-build/... apply.sh has no usage in dry-run; steps above are the scripted order"
step "python3 android/desktop/pc-ab-device/pc-firmware.py prepare $SRC <firmware checkout>"
step "WARNING: pc-firmware.py DEVICE_REVISION 50dc1471 does not match pinned device/virt/virtio_x86_64 revision 0e8571a0; prepare would refuse until DEVICE_REVISION is updated"
step "python3 android/desktop/pc-ab-device/updater-feed.py configure_release packages/apps/Updater <feed-url>   # (prints; verify step needs a built APK)"
step "m target-files-package otatools"
step "bash android/desktop/pc-ab-device/make-tf-disk.sh <target-files.zip> <stock-disk-image> <output-disk-image>"
step "ota_from_target_files <target-files.zip> <full-ota.zip>   # full OTA"
step "ota_from_target_files -i <v1-target-files.zip> <v2-target-files.zip> <incremental-ota.zip>   # incremental OTA"
step "AWAI4089_DRY_RUN_END"
