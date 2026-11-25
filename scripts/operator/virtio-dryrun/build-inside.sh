#!/usr/bin/env bash
# AWAI-4089 (G2): lineage_virtio_x86_64 Job build definition.
#
# WARNING: do not run this Job (approved mode) until the G2 B fix PR
# (breakfast arg, JDK PATH, ROOMSERVICE_DRYRUN, 52Gi) has landed — the
# original main build fails on paid runs.
#
# Runs inside an ubuntu container, `cd "$SRC"`, `source
# build/envsetup.sh` in the main shell (so `breakfast` and `m` are
# the build system's functions), then the chain. Dry-run by default:
# prints the command list and executes nothing.
# BILLING_ALLOWED=1 AND OWNER_APPROVED=1 executes the same list for
# real. Anything else refuses.
#
# The kit (scripts/operator/virtio-dryrun/, android/desktop/manifest/
# pinned-manifest.xml, pc-ab-device/) is built with
# scripts/operator/virtio-dryrun/make-kit.sh <commit> (git archive)
# and fetched here with KIT_URL/KIT_SHA256; its SHA is verified before
# use, and its manifest is validated before anything else after the
# download (see below).
#
# Env:
#   DRY_RUN=1              default: print only
#   BILLING_ALLOWED=1      only with OWNER_APPROVED=1 executes
#   OWNER_APPROVED=1       only with BILLING_ALLOWED=1 executes
#   RELEASE_TYPE           REQUIRED: user | userdebug (no silent default)
#   AWAI_VIRTIO_DEADLINE_SECONDS  minimum 28800 (8h per Job)
#   MANIFEST_FILE          pinned-manifest.xml (default: from the kit)
#   SRC                    source root (default /root/build/src)
#   KIT                    kit directory (default <work>/kit)
#   KIT_URL                kit tarball URL (required in approved mode)
#   KIT_SHA256             kit tarball sha256 (required in approved mode)
#   AWAI_FEED_URL          feed URL (required in every mode; no default)
#   FIRMWARE_GIT           firmware checkout (default <work>/firmware/src)
#   AWAI_POOL_LABEL        B2 pool label (required in approved mode)
#   BUILD_WORK_DIR         workspace root (default /root/build)
#
# Usage:
#   DRY_RUN=1 RELEASE_TYPE=userdebug AWAI_FEED_URL=.. bash build-inside.sh
#   BILLING_ALLOWED=1 OWNER_APPROVED=1 RELEASE_TYPE=userdebug ... bash build-inside.sh
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
BUILD_WORK_DIR=${BUILD_WORK_DIR:-/root/build}
SRC=${SRC:-/root/build/src}
KIT=${KIT:-"$BUILD_WORK_DIR/kit"}
UP=${UP:-"$BUILD_WORK_DIR/upload"}
FIRMWARE_GIT=${FIRMWARE_GIT:-"$BUILD_WORK_DIR/firmware/src"}
EXPECTED_MANIFEST_SHA256=61c11f507fa14329229c16a635890b2c6d5f2f4e5a648a77045a09f7f4194d7d
MIN_DEADLINE_SECONDS=28800
PRODUCT_OUT="$SRC/out/target/product/virtio_x86_64"
TF_V1_SRC="$PRODUCT_OUT/obj/PACKAGING/target_files_intermediates/lineage_virtio_x86_64-target_files.zip"
TESTKEY="$SRC/build/make/target/product/security/testkey"
export SRC BUILD_WORK_DIR KIT UP MANIFEST_FILE

# Approval gate.
if [[ ${DRY_RUN:-} == 1 ]]; then
  APPROVED=0
elif [[ ${BILLING_ALLOWED:-} == 1 && ${OWNER_APPROVED:-} == 1 ]]; then
  APPROVED=1
  echo "AWAI4089_BILLING_MODE: BILLING_ALLOWED=1 OWNER_APPROVED=1 recorded" >&2
else
  echo "AWAI4089_REFUSES: DRY_RUN=1 (default) or BILLING_ALLOWED=1+OWNER_APPROVED=1 is required." >&2
  exit 2
fi

# RELEASE_TYPE: explicit, no default.
case "${RELEASE_TYPE:-}" in
  user|userdebug) ;;
  *)
    echo "AWAI4089_REFUSES: RELEASE_TYPE must be explicitly set to user or userdebug (got '${RELEASE_TYPE:-<unset>}')." >&2
    exit 2
    ;;
esac

# Deadline: 8h per Job minimum 28800.
DEADLINE=${AWAI_VIRTIO_DEADLINE_SECONDS:-28800}
if ! [[ $DEADLINE =~ ^[0-9]+$ ]] || (( DEADLINE < MIN_DEADLINE_SECONDS )); then
  echo "AWAI4089_REFUSES: AWAI_VIRTIO_DEADLINE_SECONDS must be >= $MIN_DEADLINE_SECONDS (8h per Job; got '${DEADLINE}')." >&2
  exit 2
fi

# Feed URL: required env, no default.
if [[ -z ${AWAI_FEED_URL:-} ]]; then
  echo "AWAI4089_REFUSES: AWAI_FEED_URL is required (feed URL must come from the environment; no default)." >&2
  exit 2
fi

# Executing requires kit + pool env.
if (( APPROVED )); then
  if [[ -z ${KIT_URL:-} ]] || [[ -z ${KIT_SHA256:-} ]]; then
    echo "AWAI4089_REFUSES: KIT_URL and KIT_SHA256 are required to execute (operator provides the kit)." >&2
    exit 2
  fi
  if [[ -z ${AWAI_POOL_LABEL:-} ]]; then
    echo "AWAI4089_REFUSES: AWAI_POOL_LABEL is required to execute (B2 pool label for artifact paths)." >&2
    exit 2
  fi
fi
POOL=${AWAI_POOL_LABEL:-<pool>}

stage() { printf 'AWAI4089_STAGE=%s %s\n' "$1" "$(date -u +%FT%TZ)"; }

# run: print (dry-run with prefix, approved without) and, in approved
# mode, execute. Steps that must persist in the current shell
# (source, breakfast, m) go through eval; the rest run directly.
run() {
  local first=$1; shift || true
  if (( APPROVED )); then
    printf '%s %s\n' "$first" "$*"
  else
    printf '[dry-run] %s %s\n' "$first" "$*"
  fi
  if (( APPROVED )); then
    case "$first" in
      source|breakfast|m) eval "$first $*";;
      *"="*) eval "$first $*";;
      *) "$first" "$@";;
    esac
  fi
}

# Toolchain (same list as same-build/workflow.sh) + repo binary.
run apt-get -qq update
run apt-get -qq install -y bc bison build-essential ca-certificates ccache cmake curl flex g++-multilib gcc-multilib gdisk git git-lfs gperf imagemagick lib32readline-dev lib32z1-dev libclang-18-dev libegl1 libelf-dev libglvnd-dev liblapack-dev liblz4-tool libopenblas-dev libpam-pwquality libsdl1.2-dev libssl-dev libxml2 libxml2-utils lz4 openjdk-21-jdk-headless lzop ninja-build pkg-config python-is-python3 python3 python3-dev python3-jsonschema python3-mako python3-packaging python3-pip python3-pycparser python3-ply python3-yaml rclone rsync schedtool squashfs-tools unzip xorriso xsltproc zip zstd
run mkdir -p "$KIT" "$BUILD_WORK_DIR/bin" "$UP/v1"
run curl -fsSL https://storage.googleapis.com/git-repo-downloads/repo -o "$BUILD_WORK_DIR/bin/repo"
run chmod a+x "$BUILD_WORK_DIR/bin/repo"

# Kit fetch + SHA-verify BEFORE use (real python3 computes the digest).
# Skip the download if the kit is already extracted (e.g. by the Job
# command's own fetch, which verify-then-extracts before calling this
# script); then never overwrite the running script.
if [[ -f "$KIT/android/desktop/manifest/pinned-manifest.xml" ]]; then
  printf 'AWAI4089_KIT_PRESENT %s\n' "$KIT"
else
  run curl -fsSL "${KIT_URL:-<KIT_URL>}" -o "$BUILD_WORK_DIR/kit.tar.gz"
  run python3 -c 'import hashlib,sys; d=hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest(); sys.exit(0 if d==sys.argv[2] else 1)' "$BUILD_WORK_DIR/kit.tar.gz" "${KIT_SHA256:-<KIT_SHA256>}"
  run tar -xzf "$BUILD_WORK_DIR/kit.tar.gz" -C "$KIT"
fi

# The kit carries the manifest; fall back to the repo copy for dry-run
# before a kit exists.
MANIFEST_FILE=${MANIFEST_FILE:-"$KIT/android/desktop/manifest/pinned-manifest.xml"}
if [[ ! -f $MANIFEST_FILE ]]; then
  MANIFEST_FILE="$here/../../.."//android/desktop/manifest/pinned-manifest.xml
fi
export MANIFEST_FILE
actual=$(shasum -a 256 "$MANIFEST_FILE" | awk '{print $1}')
if [[ $actual != "$EXPECTED_MANIFEST_SHA256" ]]; then
  echo "AWAI4089_REFUSES: pinned manifest SHA-256 differs: got $actual want $EXPECTED_MANIFEST_SHA256" >&2
  exit 1
fi
printf 'AWAI4089_MANIFEST_SHA256_VALIDATED %s %s\n' "$EXPECTED_MANIFEST_SHA256" "$MANIFEST_FILE"
printf 'AWAI4089_RELEASE_TYPE=%s AWAI4089_DEADLINE_SECONDS=%s AWAI4089_APPROVED=%s\n' \
  "$RELEASE_TYPE" "$DEADLINE" "$APPROVED"
# $BUILD_WORK_DIR/bin comes first: it holds the pinned `repo` this
# script fetched for itself, which must win over any preinstalled repo.
# The kit's own tools follow (harness stubs sit ahead via the caller's
# PATH, so they still shadow them in tests). The prebuilt JDK 21 is
# needed by ota_from_target_files (ab-ota.sh).
export PATH="$SRC/prebuilts/jdk/jdk21/linux-x86/bin:$BUILD_WORK_DIR/bin:$PATH:$KIT/pc-ab-device:$SRC/out/host/linux-x86/bin"

# Git identity, then sync from $SRC.
run git config --global user.email virtio-g2@awai.network
run git config --global user.name "Awai virtio G2"
run mkdir -p "$SRC"
run cd "$SRC"
run repo init -u https://github.com/LineageOS/android.git -b lineage-24.0 --no-clone-bundle
run cp "$MANIFEST_FILE" "$SRC/.repo/manifests/default.xml"
run repo sync -m default.xml --no-manifest-update -c --no-clone-bundle --optimized-fetch -j4
run repo manifest -r -o "$UP/pinned-manifest.xml"
run python3 "$here/check-manifest-revisions.py" "$MANIFEST_FILE" "$UP/pinned-manifest.xml"
stage sync

# Firmware input for pc-firmware.py prepare (existing pinned input:
# kernel.org linux-firmware at a2dcb924, the same REVISION the tool
# pins; 4092's rtw89/rtw8851b_fw .bin/-1.bin add to this input via
# pc-firmware.py's FIRMWARE — no NEW input is required).
# kernel.org has no server filter for kernel.org's small-repo clone;
# allow 20 minutes for the fetch (no low-speed limit abort).
run mkdir -p "$BUILD_WORK_DIR/firmware"
run git init -q "$FIRMWARE_GIT"
run timeout 20m git -C "$FIRMWARE_GIT" fetch -q --depth 1 https://git.kernel.org/pub/scm/linux/kernel/git/firmware/linux-firmware.git a2dcb924f0897368b0b4f305cbf9808cdda90ce0
run git -C "$FIRMWARE_GIT" checkout -q FETCH_HEAD

# Repo's own apply tools, in repo order. No second explicit list.
run apply.sh "$SRC"
run apply-shipping-debug-lockdown.sh "$SRC"
run pc-firmware.py prepare "$SRC" "$FIRMWARE_GIT"
run updater-feed.py configure-release "$SRC/packages/apps/Updater" "$AWAI_FEED_URL"

# SetupWizard (Awai Welcome): pinned checkout + patch + resources/logo,
# same inputs as same-build (scripts/operator/same-build/inputs).
# Pinned to the manifest rev (verified: setupwizard-awai.patch applies
# with rc=0 there); ordered before breakfast/m so Welcome ships.
run git -C "$SRC/packages/apps/SetupWizard" checkout 1d158e23847b5d9f9523ce6cfc51df2b0c54f6cd
run git -C "$SRC/packages/apps/SetupWizard" apply --check "$KIT/scripts/operator/same-build/inputs/setupwizard-awai.patch"
run git -C "$SRC/packages/apps/SetupWizard" apply "$KIT/scripts/operator/same-build/inputs/setupwizard-awai.patch"
run mkdir -p "$SRC/packages/apps/SetupWizard/app/src/main/res/drawable-nodpi"
run cp -r "$KIT/scripts/operator/same-build/inputs/res/." "$SRC/packages/apps/SetupWizard/app/src/main/res/"
run cp "$KIT/scripts/operator/same-build/inputs/setup-logo.png" "$SRC/packages/apps/SetupWizard/app/src/main/res/drawable-nodpi/awai_welcome_logo.png"
stage patches
# Record how many patch files the kit provides at run time: ALL of
# pc-ab-device/patches/*.patch plus the SetupWizard patch, which ships
# outside pc-ab-device (same-build inputs). They are time-bearing:
# patches merged to main later — e.g. AWAI-4092 Wi-Fi or
# 4093 diagnostics — are included automatically via these paths.
PCNT=$(ls "$KIT"/pc-ab-device/patches/*.patch "$KIT"/scripts/operator/same-build/inputs/setupwizard-awai.patch 2>/dev/null | wc -l | tr -d ' ' || true)
printf 'AWAI4089_PATCH_COUNT=%s\n' "${PCNT:-0}"
# No standalone `make olddefconfig`: the AOSP build already merges
# the external defconfig (vendor/lineage@5a1814d..., KERNEL_DEFCONFIG_EXT
# line 116 in build/tasks/kernel.mk) and runs olddefconfig itself
# (same file, lines 309-334 via internal-make-kernel-target /
# make-kernel-target), with the ARCH/CROSS_COMPILE/O the build needs.
# A separate `make -C ... olddefconfig` would produce a different
# .config than the build uses. Flow: patch -> (m merges config +
# runs olddefconfig) -> m.

# Lunch + v1 build, saved in two stages (BEFORE v2; failure in v2
# keeps v1). The target-files go to B2 FIRST so a make-tf-disk.sh
# failure cannot lose them; the disk image follows separately.
# ROOMSERVICE_DRYRUN prevents duplicate external projects; ccache
# matches ab-build.sh (dir is ephemeral per build).
run export ROOMSERVICE_DRYRUN=true
run export USE_CCACHE=1 CCACHE_EXEC=/usr/bin/ccache CCACHE_DIR="$BUILD_WORK_DIR/ccache"
run source build/envsetup.sh
run breakfast virtio_x86_64 "$RELEASE_TYPE"
stage breakfast
run m target-files-package otatools diskimage-vda
run cp "$TF_V1_SRC" "$UP/v1/virtio-target-files-v1.zip"
run mkdir -p "$UP/v1-tf"
run cp "$UP/v1/virtio-target-files-v1.zip" "$UP/v1-tf/virtio-target-files-v1.zip"
run rclone copy "$UP/v1-tf" art:awai-os-release-artifacts/awai-virtio-g2/${POOL}/v1/
stage v1-target-files-upload
run make-tf-disk.sh "$UP/v1/virtio-target-files-v1.zip" "$PRODUCT_OUT/disk-vda.img" "$UP/v1/virtio-install-image.img"
run rclone copy "$UP/v1" art:awai-os-release-artifacts/awai-virtio-g2/${POOL}/v1/
stage v1-upload

# v2 rebuild (BUILD_NUMBER change; precedent ~336s) + real OTA.
# `env BUILD_NUMBER=... m ...` would NOT work: `env` only finds
# executables, not the shell function `m`.
run BUILD_NUMBER=awai-g2-v2 BUILD_DATETIME="$(date +%s)" m target-files-package
stage v2-build
run cp "$TF_V1_SRC" "$UP/virtio-target-files.zip"
run ota_from_target_files -k "$TESTKEY" "$TF_V1_SRC" "$UP/virtio-full-ota.zip"
run ota_from_target_files -k "$TESTKEY" -i "$UP/v1/virtio-target-files-v1.zip" "$TF_V1_SRC" "$UP/virtio-incremental-ota.zip"
stage ota

# Collect: install image, manifest.json + SHA256SUMS, B2 upload, restore verify.
run cp "$UP/v1/virtio-install-image.img" "$UP/virtio-install-image.img"
run python3 -c 'import hashlib,json,os,sys; d=lambda p: (os.path.getsize(p), hashlib.sha256(open(p,"rb").read()).hexdigest()); root,out=sys.argv[1],sys.argv[2]; names=sys.argv[4:]; man={"prefix":"awai-virtio-g2/" + sys.argv[3] + "/","objects":[{"path":n,"size":d(os.path.join(root,n))[0],"sha256":d(os.path.join(root,n))[1]} for n in names]}; open(out,"w").write(json.dumps(man,indent=1))' "$UP" "$UP/manifest.json" "$POOL" virtio-target-files.zip virtio-install-image.img virtio-full-ota.zip virtio-incremental-ota.zip pinned-manifest.xml
run bash -c 'cd '"$UP"' && sha256sum virtio-target-files.zip virtio-install-image.img virtio-full-ota.zip virtio-incremental-ota.zip pinned-manifest.xml manifest.json > SHA256SUMS'
run rclone copy "$UP" art:awai-os-release-artifacts/awai-virtio-g2/${POOL}/
stage upload
run rclone copy art:awai-os-release-artifacts/awai-virtio-g2/${POOL}/ "$BUILD_WORK_DIR/restore/"
run python3 -c 'import hashlib,json,os,sys; root=sys.argv[1]; man=json.load(open(os.path.join(root,"manifest.json"))); fails=[n for n in man["objects"] if (os.path.getsize(os.path.join(root,n["path"])), hashlib.sha256(open(os.path.join(root,n["path"]),"rb").read()).hexdigest()) != (n["size"], n["sha256"])]; print("AWAI4089_RESTORE_VERIFY", "ok" if not fails else fails); sys.exit(1 if fails else 0)' "$BUILD_WORK_DIR/restore"
run bash -c 'cd '"$BUILD_WORK_DIR/restore"' && sha256sum -c SHA256SUMS'
stage restore
printf 'AWAI4089_DONE approved=%s\n' "$APPROVED"
