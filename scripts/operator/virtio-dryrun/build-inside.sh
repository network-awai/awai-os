#!/usr/bin/env bash
# AWAI-4089 (G2): lineage_virtio_x86_64 Job definition (dry-run default).
#
# Prints the exact steps a future paid build would run. Refuses unless
# DRY_RUN=1 (default) OR (BILLING_ALLOWED=1 AND OWNER_APPROVED=1).
# Nothing here creates a node pool, runs access-control or workload
# tools, or calls a paid API: with DRY_RUN=1 the script only validates
# the pinned manifest input (read-only) and prints steps; `repo sync`
# is printed, never run, and the Job is never produced unless gated.
#
# Env:
#   DRY_RUN=1              required (unless BILLING_ALLOWED+OWNER_APPROVED)
#   BILLING_ALLOWED=1      only with OWNER_APPROVED=1 permits a real run
#   OWNER_APPROVED=1       only with BILLING_ALLOWED=1 permits a real run
#   RELEASE_TYPE           REQUIRED: user | userdebug (no silent default)
#   AWAI_VIRTIO_DEADLINE_SECONDS  Job/call deadline; default 28800, min 28800
#   MANIFEST_FILE          pinned-manifest.xml to validate (default: the
#                          committed android/desktop/manifest copy)
#   SRC                    source root for --validate-against (default
#                          /root/build/src)
#   KIT                    kit directory holding pinned-manifest.xml,
#                          pc-ab-device/ and ota helpers (default:
#                          /root/build/kit/virtio-dryrun)
#   FIRMWARE_GIT           linux-firmware git checkout (for prepare)
#   AWAI_FEED_URL          feed URL for configure-release (recorded)
#
# Usage:
#   DRY_RUN=1 RELEASE_TYPE=userdebug bash build-inside.sh
#   DRY_RUN=1 bash build-inside.sh --validate-against <src root>
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
repo_root=$(cd "$here/../../.." && pwd)
MANIFEST_FILE=${MANIFEST_FILE:-"$repo_root/android/desktop/manifest/pinned-manifest.xml"}
SRC=${SRC:-/root/build/src}
KIT=${KIT:-/root/build/kit/virtio-dryrun}
FIRMWARE_GIT=${FIRMWARE_GIT:-/root/build/firmware/src}
EXPECTED_MANIFEST_SHA256=61c11f507fa14329229c16a635890b2c6d5f2f4e5a648a77045a09f7f4194d7d
MIN_DEADLINE_SECONDS=28800

# Approval gate: DRY_RUN=1 is the default (dry-run printing only).
# Any real-run mode needs explicit owner approval with billing allowed.
if [[ ${DRY_RUN:-} == 1 ]]; then
  :
elif [[ ${BILLING_ALLOWED:-} == 1 && ${OWNER_APPROVED:-} == 1 ]]; then
  echo "AWAI4089_BILLING_MODE: BILLING_ALLOWED=1 OWNER_APPROVED=1 recorded" >&2
else
  echo "AWAI4089_REFUSES: DRY_RUN=1 (default) or BILLING_ALLOWED=1+OWNER_APPROVED=1 is required." >&2
  exit 2
fi

# RELEASE_TYPE is an explicit parameter: no silent default anywhere.
case "${RELEASE_TYPE:-}" in
  user|userdebug) ;;
  *)
    echo "AWAI4089_REFUSES: RELEASE_TYPE must be explicitly set to user or userdebug (got '${RELEASE_TYPE:-<unset>}')." >&2
    exit 2
    ;;
esac

# Deadline: 8h per Job, minimum 28800 seconds. Below the minimum: refuse.
DEADLINE=${AWAI_VIRTIO_DEADLINE_SECONDS:-28800}
if ! [[ $DEADLINE =~ ^[0-9]+$ ]] || (( DEADLINE < MIN_DEADLINE_SECONDS )); then
  echo "AWAI4089_REFUSES: AWAI_VIRTIO_DEADLINE_SECONDS must be >= $MIN_DEADLINE_SECONDS (8h per Job; got '${DEADLINE}')." >&2
  exit 2
fi

# Validate the pinned manifest input before anything else. The
# manifest is used as-is (never re-resolved); repo sync would consume
# it installed as .repo/manifests/default.xml, printed in step 2.
actual=$(shasum -a 256 "$MANIFEST_FILE" | awk '{print $1}')
if [[ $actual != "$EXPECTED_MANIFEST_SHA256" ]]; then
  echo "AWAI4089_REFUSES: pinned manifest SHA-256 differs: got $actual want $EXPECTED_MANIFEST_SHA256" >&2
  exit 1
fi
printf 'AWAI4089_MANIFEST_SHA256_VALIDATED %s %s\n' "$EXPECTED_MANIFEST_SHA256" "$MANIFEST_FILE"
printf 'AWAI4089_RELEASE_TYPE=%s AWAI4089_DEADLINE_SECONDS=%s\n' "$RELEASE_TYPE" "$DEADLINE"

# --validate-against: run the repo's own apply tools against a fixture
# tree, aborting with AWAI4089_NOT_APPLICABLE at the first failure.
# (apply.sh, then lockdown --check; the failure path is the offline
# test hook proving a non-applicable patch aborts.)
if [[ ${1:-} == --validate-against && -n ${2:-} ]]; then
  SRC=$2
  patchdir="$repo_root/android/desktop/pc-ab-device"
  if ! bash "$patchdir/apply.sh" "$SRC"; then
    echo "AWAI4089_NOT_APPLICABLE: apply.sh failed (a patch does not apply at the pinned tree)." >&2
    exit 1
  fi
  if ! bash "$patchdir/apply-shipping-debug-lockdown.sh" --check "$SRC"; then
    echo "AWAI4089_NOT_APPLICABLE: apply-shipping-debug-lockdown.sh --check reported a mismatch." >&2
    exit 1
  fi
  echo "AWAI4089_VALIDATION_DONE"
  exit 0
fi

# Stage handoff, used by the next run's estimate (OTA interval timing).
stage() { printf 'AWAI4089_STAGE=%s %s\n' "$1" "$(date -u +%FT%TZ)"; }
step()  { printf '[dry-run] %s\n' "$*"; }

step "AWAI4089_DRY_RUN_BEGIN"
step "stage=toolchain, tool list: bc bison build-essential ca-certificates ccache cmake curl flex g++-multilib gcc-multilib git git-lfs gperf imagemagick lib32readline-dev lib32z1-dev libclang-18-dev libegl1 libelf-dev libglvnd-dev liblapack-dev liblz4-tool libopenblas-dev libpam-pwquality libsdl1.2-dev libssl-dev libxml2 libxml2-utils lz4 lzop ninja-build pkg-config python-is-python3 python3-dev python3-jsonschema python3-mako python3-packaging python3-pip python3-pycparser python3-ply python3-yaml rclone rsync schedtool squashfs-tools unzip xorriso xsltproc zip zstd (apt-get install; image ubuntu@sha256:9a04f13b3f80ef056361e30868593b1cfd2279fe19e4081cb93a90bf56819d6a)"
stage toolchain
step "mkdir -p /root/build/kit; rclone copy art:awai-os-release-artifacts/awai-virtio-g2/kit/ /root/build/kit/ --checksum   # kit tarball (this repo at head) is uploaded by the operator; the Job fetches it"
step "install repo binary: curl -fsSL https://storage.googleapis.com/git-repo-downloads/repo > /root/build/bin/repo; chmod a+x /root/build/bin/repo"
step "repo init -u https://github.com/LineageOS/android.git -b lineage-24.0 --no-clone-bundle   # cwd=$SRC"
step "install pinned manifest as-is: cp $MANIFEST_FILE $SRC/.repo/manifests/default.xml   # sha256 $EXPECTED_MANIFEST_SHA256"
step "repo sync -m default --no-manifest-update -c --no-clone-bundle --optimized-fetch -j\"(nproc)\"   # NOT RUN under DRY_RUN; the pinned file is used as the manifest and sync cannot update it"
step "repo manifest -r -o /root/build/upload/pinned-manifest.xml"
step "python3 $here/check-manifest-revisions.py $MANIFEST_FILE /root/build/upload/pinned-manifest.xml   # compare all 1264 path->revision entries; fail on any difference"
stage sync
step "bash $KIT/pc-ab-device/apply.sh $SRC"
step "bash $KIT/pc-ab-device/apply-shipping-debug-lockdown.sh $SRC"
step "python3 $KIT/pc-ab-device/pc-firmware.py prepare $SRC $FIRMWARE_GIT   # DEVICE_REVISION aligned to pinned 0e8571a0 (recorded; see applicability doc)"
step "python3 $KIT/pc-ab-device/updater-feed.py configure-release $SRC/packages/apps/Updater \${AWAI_FEED_URL:-https://example.invalid/feed.json}"
stage patches
step "EXCLUDED mkbootimg-header-version.patch: not applicable at device/mainline/generic 3d402dc5 (no BOARD_BOOT_HEADER_VERSION)"
step "NOTE virtio-userdata-ext4-checkpoint.patch is superseded: apply.sh skips it after the block variant via --reverse --check; the patch itself is not applied"
step "source build/envsetup.sh"
step "breakfast lineage_virtio_x86_64 $RELEASE_TYPE"
stage breakfast
step "v1 build: m target-files-package otatools diskimage-vda   # target-files (v1) + install-image source"
step "cp /root/build/src/out/target/product/virtio_x86_64/obj/PACKAGING/target_files_intermediates/lineage_virtio_x86_64-target_files.zip /root/build/upload/v1/virtio-target-files-v1.zip"
step "install image: bash $KIT/pc-ab-device/make-tf-disk.sh <target-files.zip> <stock-disk-image> /root/build/upload/v1/virtio-install-image.img"
step "upload v1 to B2 BEFORE the v2 build: rclone copy /root/build/upload/v1/ art:awai-os-release-artifacts/awai-virtio-g2/<pool>/v1/  (bucket pattern: scripts/operator/queue-vke-pc-release.sh)"
stage v1-upload
step "v2 build (BUILD_NUMBER rebuild from the same tree; precedent ~336s): BUILD_NUMBER=awai-virtio-g2-v2 BUILD_DATETIME=<now> m target-files-package"
stage v2-build
step "full OTA: python3 $KIT/pc-ab-device/updater-feed.py generate-ota <v2-target-files.zip> /root/build/upload/virtio-full-ota.zip --key testkey --certificate-sha256 <sha> --target-sha256 <sha> --checker check_ota_package_signature"
step "incremental OTA: python3 $KIT/pc-ab-device/updater-feed.py generate-ota <v2-target-files.zip> /root/build/upload/virtio-incremental-ota.zip --key testkey --certificate-sha256 <sha> --target-sha256 <sha> --source-target-files /root/build/upload/v1/virtio-target-files-v1.zip --source-sha256 <sha> --checker check_ota_package_signature"
stage ota
step "collect + SHA256SUMS + manifest.json (path/size/sha256) -> B2 upload (pattern: scripts/operator/queue-vke-pc-release.sh manifest generation)"
step "restore verify: rclone copy art:awai-os-release-artifacts/awai-virtio-g2/<pool>/ /root/build/restore/; verify per-object size+sha256 against manifest.json and sha256sum -c SHA256SUMS"
stage restore
step "AWAI4089_DRY_RUN_END"
