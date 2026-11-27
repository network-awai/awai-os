#!/usr/bin/env bash
# AWAI-4089 (G2): lineage_virtio_x86_64 Job build definition.
#
# WARNING: gad is the preferred build host for this candidate.
# Approved execution requires the host capacity decision and procedure
# described in README.md.
#
# Runs inside an ubuntu container, `cd "$SRC"`, `source
# build/envsetup.sh` in the main shell (so `breakfast` and `m` are
# the build system's functions), then the chain. It is unverified that
# `source build/envsetup.sh` and `breakfast` work under `set -e` — this
# remains unproven until a real build confirms it. Dry-run by default:
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
#   AWAI_WITHOUT_APPS=1    apps mode: evaluation only; refused for user
#   AWAI_APK_STAGE         prebuilt mode: private B2 stage ID
#   AWAI_HOME_APK          direct build only: local Awai Home APK path
#   AWAI_STORE_APK         direct build only: local Awai Store APK path
#   AWAI_APKSIGNER         direct build only: local Android apksigner path
#   AWAI_HOME_APK_SHA256               approved Home file SHA-256
#   AWAI_STORE_APK_SHA256              approved Store file SHA-256
#   AWAI_HOME_EXPECTED_SIGNER_SHA256   approved Home signer SHA-256
#   AWAI_STORE_EXPECTED_SIGNER_SHA256  approved Store signer SHA-256
#   AWAI_VIRTIO_DEADLINE_SECONDS  minimum 28800 (8h per Job)
#   MANIFEST_FILE          pinned-manifest.xml (default: from the kit)
#   SRC                    source root (default /root/build/src)
#   KIT                    kit directory (default <work>/kit)
#   KIT_URL                kit tarball URL (required in approved mode)
#   KIT_SHA256             kit tarball sha256 (required in approved mode)
#   AWAI_FEED_URL          feed URL (required in every mode; no default)
#   AWAI_M_JOBS            optional `m -jN` cap (integer 1..64). Unset keeps
#                          the current bare `m` (Soong default). The gad
#                          34GiB frame starts at 4; validated before use.
#   AWAI_RUST_PREPASS_JOBS optional low-parallel Rust pre-pass `-jN`
#                          (integer 1..64); requires AWAI_RUST_PREPASS_TARGETS.
#                          Unset means no pre-pass (current single-shot build).
#   AWAI_RUST_PREPASS_TARGETS
#                          whitespace-separated Soong module/goal names for
#                          the pre-pass, confirmed in the source tree on the
#                          build host (the crosvm Rust scope). Leading `-`
#                          (options) and shell metacharacters are refused;
#                          the array reaches `m` without reinterpretation.
#                          Example values stay desk-level until the host
#                          confirms them against the tree.
#   AWAI_CCACHE_STATS=1    print `ccache -s` after the v1 and v2 builds for
#                          cold/warm hit-rate measurement (default off).
#   FIRMWARE_GIT           firmware checkout (default <work>/firmware/src)
#   AWAI_POOL_LABEL        B2 pool label (required in approved mode)
#   BUILD_WORK_DIR         workspace root (default /root/build)
#
# Usage:
#   DRY_RUN=1 RELEASE_TYPE=userdebug AWAI_FEED_URL=.. AWAI_WITHOUT_APPS=1 bash build-inside.sh
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

# Integer 1..64 without depending on arithmetic overflow: at most two
# digits first (three or more can never be in range), then a bounded
# range check on the base-10 value.
valid_jobs() {
  [[ ${1:-} =~ ^[0-9]{1,2}$ ]] && (( 10#$1 >= 1 && 10#$1 <= 64 ))
}

# Build parallelism: unset preserves the current bare `m` (Soong
# default). An explicit integer caps every `m` invocation below and is
# validated here, before anything executes. The gad 34GiB frame starts
# at 4 (measured: -j8 cgroup-OOM at Ninja 74%; -j4 resumed to 48%
# OOM-free with peak 34GiB); other frames keep the default. The value
# travels as one optional flag word so `run` (which evals `m` with
# "$*") prints and executes the identical command list.
M_JOBS_FLAG=""
if [[ -n ${AWAI_M_JOBS:-} ]]; then
  valid_jobs "$AWAI_M_JOBS" ||
    { echo "AWAI4089_REFUSES: AWAI_M_JOBS must be an integer 1..64 (got '${AWAI_M_JOBS:-<unset>}')." >&2; exit 2; }
  M_JOBS_FLAG="-j$AWAI_M_JOBS"
fi

# crosvm Rust pre-pass: unset means no pre-pass (current single-shot
# build). When set, the named targets — confirmed in the source tree on
# the build host — build once at low parallelism before the full v1
# build, keeping their rustc peak out of the full-parallel link storm.
# Kept separate from the C/C++ ccache cold/warm measurement, which
# varies only the cache state, never this scope.
PREPASS_TARGETS=()
if [[ -n ${AWAI_RUST_PREPASS_JOBS:-} ]]; then
  valid_jobs "$AWAI_RUST_PREPASS_JOBS" ||
    { echo "AWAI4089_REFUSES: AWAI_RUST_PREPASS_JOBS must be an integer 1..64 (got '${AWAI_RUST_PREPASS_JOBS:-<unset>}')." >&2; exit 2; }
  # Soong module/goal form only: multiple whitespace-separated targets
  # are allowed, but nothing starting with `-` (an option) and nothing
  # carrying shell metacharacters. The input is defined as a single
  # line: `read` splits on LF, so a multi-line value would otherwise
  # gain extra targets while looking harmless — newlines (and carriage
  # returns) are refused outright. A whitespace-only value counts as
  # missing. `read` may report failure on empty input under `set -e`,
  # so its status is ignored and the array length decides.
  [[ ${AWAI_RUST_PREPASS_TARGETS:-} != *$'\n'* && ${AWAI_RUST_PREPASS_TARGETS:-} != *$'\r'* ]] ||
    { echo "AWAI4089_REFUSES: AWAI_RUST_PREPASS_TARGETS must be a single line." >&2; exit 2; }
  read -ra PREPASS_TARGETS <<< "${AWAI_RUST_PREPASS_TARGETS:-}" || true
  (( ${#PREPASS_TARGETS[@]} > 0 )) ||
    { echo "AWAI4089_REFUSES: AWAI_RUST_PREPASS_TARGETS is required when AWAI_RUST_PREPASS_JOBS is set." >&2; exit 2; }
  for t in "${PREPASS_TARGETS[@]}"; do
    [[ $t =~ ^[A-Za-z0-9_][A-Za-z0-9_.:/-]*$ ]] ||
      { echo "AWAI4089_REFUSES: AWAI_RUST_PREPASS_TARGETS must be whitespace-separated Soong module/goal names (got '$t')." >&2; exit 2; }
  done
fi

# Validate the explicit apps mode again inside the worker.
source "$here/apk-inputs.sh"
validate_apps_mode build
unset AWAI_ALLOW_UNVERIFIED_APKS
if (( apps_prebuilt )); then
  unset AWAI_WITHOUT_APPS
  APPS_MODE_LOG="prebuilt home=$AWAI_HOME_EXPECTED_SIGNER_SHA256 store=$AWAI_STORE_EXPECTED_SIGNER_SHA256"
else
  export AWAI_WITHOUT_APPS=1
  APPS_MODE_LOG="without-apps (evaluation)"
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

stage() { printf 'AWAI4089_STAGE=%s %s epoch=%s\n' "$1" "$(date -u +%FT%TZ)" "$(date +%s)"; }

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
if [[ -n ${AWAI_APK_STAGE:-} ]]; then
  run apt-get -qq install -y apksigner=31.0.2-1ubuntu1
fi
run mkdir -p "$KIT" "$BUILD_WORK_DIR/bin" "$UP/v1"

# Kit fetch + SHA-verify BEFORE use (real python3 computes the digest).
# Skip the download if the kit is already extracted (e.g. by the Job
# command's own fetch, which verify-then-extracts before calling this
# script); then never overwrite the running script.
if [[ -f "$KIT/android/desktop/manifest/pinned-manifest.xml" ]]; then
  printf 'AWAI4089_KIT_PRESENT %s\n' "$KIT"
else
  if (( APPROVED )); then
    curl -fsSL "$KIT_URL" -o "$BUILD_WORK_DIR/kit.tar.gz" 2>/dev/null ||
      { echo "AWAI4089_REFUSES: kit download failed." >&2; exit 2; }
  else
    printf "[dry-run] curl -fsSL \$KIT_URL -o %s/kit.tar.gz\n" "$BUILD_WORK_DIR"
  fi
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
printf 'AWAI4089_M_JOBS=%s RUST_PREPASS_JOBS=%s CCACHE_STATS=%s\n' \
  "${AWAI_M_JOBS:-default}" "${AWAI_RUST_PREPASS_JOBS:-off}" "${AWAI_CCACHE_STATS:-0}"
# One recorded line per run and per dry-run print, naming the chosen mode.
printf 'AWAI4094_APPS: %s\n' "$APPS_MODE_LOG"
# A verified APK pair alone cannot produce a shipping build. Check the
# same kit and apply script the user build will consume before checkout.
if [[ $RELEASE_TYPE == user ]]; then
  run python3 "$here/check-home-store-integration.py" "$KIT" || exit 2
fi
if (( apps_prebuilt )); then
  # Snapshot before verification. Keep these bytes private until copying
  # them to the device tree, even when the original inputs are local files.
  if (( APPROVED )); then
    if [[ -n ${AWAI_APK_STAGE:-} ]]; then
      AWAI_APKSIGNER=$(command -v apksigner) || apk_refuse "apksigner is missing after installation."
    fi
    [[ -f $AWAI_APKSIGNER && -x $AWAI_APKSIGNER ]] || apk_refuse "apksigner is missing or not executable."
    apk_dir=$(mktemp -d "$BUILD_WORK_DIR/apks.XXXXXXXX")
    trap 'rm -rf -- "$apk_dir"' EXIT
    if [[ -n ${AWAI_APK_STAGE:-} ]]; then
      fetch_staged_apk AwaiHome.apk "$apk_dir/AwaiHome.apk"
      fetch_staged_apk AwaiStore.apk "$apk_dir/AwaiStore.apk"
    else
      snapshot_local_apk "$AWAI_HOME_APK" "$apk_dir/AwaiHome.apk"
      snapshot_local_apk "$AWAI_STORE_APK" "$apk_dir/AwaiStore.apk"
    fi
    verify_apk "$apk_dir/AwaiHome.apk" "$AWAI_HOME_APK_SHA256" "$AWAI_HOME_EXPECTED_SIGNER_SHA256"
    verify_apk "$apk_dir/AwaiStore.apk" "$AWAI_STORE_APK_SHA256" "$AWAI_STORE_EXPECTED_SIGNER_SHA256"
    chmod a-w "$apk_dir/AwaiHome.apk" "$apk_dir/AwaiStore.apk"
  else
    apk_dir="$BUILD_WORK_DIR/apks.<run>"
    printf "[dry-run] stage Home and Store privately, then verify each file SHA-256 and apksigner signer SHA-256\n"
  fi
  export AWAI_HOME_EXPECTED_SIGNER_SHA256 AWAI_STORE_EXPECTED_SIGNER_SHA256 AWAI_APKSIGNER
fi

# Tool download follows APK preflight and precedes any source work.
run curl -fsSL https://storage.googleapis.com/git-repo-downloads/repo -o "$BUILD_WORK_DIR/bin/repo"
run chmod a+x "$BUILD_WORK_DIR/bin/repo"

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

# Repo's own apply tools, in repo order. The shipping build uses the
# checked script by path and confirms its product patch reached the tree.
if [[ $RELEASE_TYPE == user ]]; then
  run sh "$KIT/pc-ab-device/apply.sh" "$SRC"
  run git -C "$SRC/device/virt/virtio-common" apply --reverse --check \
    "$KIT/pc-ab-device/patches/virtio-common-awai-apps.patch" ||
    apk_refuse "the kit's Home/Store integration was not applied to the source tree."
else
  run apply.sh "$SRC"
fi
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
# #523's guard reads these filenames before `m`. Copy from the private
# snapshot checked before repo init.
if (( apps_prebuilt )); then
  AWAI_APPS_DIR="$SRC/device/virt/virtio-common/awai-apps"
  run mkdir -p "$AWAI_APPS_DIR"
  run cp "$apk_dir/AwaiHome.apk" "$AWAI_APPS_DIR/AwaiHome.apk"
  run cp "$apk_dir/AwaiStore.apk" "$AWAI_APPS_DIR/AwaiStore.apk"
fi
run export ROOMSERVICE_DRYRUN=true
run export USE_CCACHE=1 CCACHE_EXEC=/usr/bin/ccache CCACHE_DIR="$BUILD_WORK_DIR/ccache"
run source build/envsetup.sh
run breakfast virtio_x86_64 "$RELEASE_TYPE"
stage breakfast
if (( ${#PREPASS_TARGETS[@]} > 0 )); then
  stage rust-prepass
  # Argument array straight into the `m` function: the targets were
  # validated above, and the shell never re-splits or re-evaluates them
  # (unlike `run`, which evals `m` with "$*"). The printed line keeps the
  # same `[dry-run] m ...` shape as every other step.
  if (( APPROVED )); then
    printf 'm -j%s %s\n' "$AWAI_RUST_PREPASS_JOBS" "${PREPASS_TARGETS[*]}"
  else
    printf '[dry-run] m -j%s %s\n' "$AWAI_RUST_PREPASS_JOBS" "${PREPASS_TARGETS[*]}"
  fi
  if (( APPROVED )); then
    m -j"$AWAI_RUST_PREPASS_JOBS" "${PREPASS_TARGETS[@]}"
  fi
fi
# shellcheck disable=SC2086
run m $M_JOBS_FLAG target-files-package otatools diskimage-vda
if [[ ${AWAI_CCACHE_STATS:-} == 1 ]]; then
  run ccache -s
fi
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
# shellcheck disable=SC2086
run BUILD_NUMBER=awai-g2-v2 BUILD_DATETIME="$(date +%s)" m $M_JOBS_FLAG target-files-package
if [[ ${AWAI_CCACHE_STATS:-} == 1 ]]; then
  run ccache -s
fi
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
