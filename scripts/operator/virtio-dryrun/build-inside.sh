#!/usr/bin/env bash
# AWAI-4089 (G2): lineage_virtio_x86_64 Job build definition.
#
# Prints the exact command list. With DRY_RUN=1 (default) it prints
# ([dry-run] prefix) and executes nothing. With BILLING_ALLOWED=1 AND
# OWNER_APPROVED=1 it executes the exact same command list (no prefix).
# Anything else refuses. In both modes this script never creates a
# node pool, runs access-control or workload tools, or calls a paid API.
#
# Env:
#   DRY_RUN=1              default: print only
#   BILLING_ALLOWED=1      only with OWNER_APPROVED=1 executes
#   OWNER_APPROVED=1       only with BILLING_ALLOWED=1 executes
#   RELEASE_TYPE           REQUIRED: user | userdebug (no silent default)
#   AWAI_VIRTIO_DEADLINE_SECONDS  minimum 28800 (8h per Job)
#   MANIFEST_FILE          pinned-manifest.xml (default: committed copy)
#   SRC                    source root (default /root/build/src)
#   KIT                    kit location (default <work>/kit)
#   KIT_URL                kit tarball URL (required in approved mode)
#   KIT_SHA256             kit tarball sha256 (required in approved mode)
#   AWAI_FEED_URL          feed URL (required in every mode; no default)
#   FIRMWARE_GIT           linux-firmware checkout (default /root/build/firmware/src)
#   BUILD_WORK_DIR         workspace root (default /root/build)
#
# Usage:
#   DRY_RUN=1 RELEASE_TYPE=userdebug AWAI_FEED_URL=https://... bash build-inside.sh
#   BILLING_ALLOWED=1 OWNER_APPROVED=1 RELEASE_TYPE=userdebug ... bash build-inside.sh
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
repo_root=$(cd "$here/../../.." && pwd)
MANIFEST_FILE=${MANIFEST_FILE:-"$repo_root/android/desktop/manifest/pinned-manifest.xml"}
SRC=${SRC:-/root/build/src}
BUILD_WORK_DIR=${BUILD_WORK_DIR:-/root/build}
KIT=${KIT:-"$BUILD_WORK_DIR/kit"}
UP=${UP:-"$BUILD_WORK_DIR/upload"}
FIRMWARE_GIT=${FIRMWARE_GIT:-/root/build/firmware/src}
EXPECTED_MANIFEST_SHA256=61c11f507fa14329229c16a635890b2c6d5f2f4e5a648a77045a09f7f4194d7d
MIN_DEADLINE_SECONDS=28800
# Exported broadly: child tools (repo stub, ota, m) read them.
export SRC BUILD_WORK_DIR KIT UP
PRODUCT_OUT="$SRC/out/target/product/virtio_x86_64"
TF_V1_SRC="$PRODUCT_OUT/obj/PACKAGING/target_files_intermediates/lineage_virtio_x86_64-target_files.zip"
TESTKEY="$SRC/build/make/target/product/security/testkey"

# Approval gate: default DRY_RUN=1 (print only).
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

# Deadline: 8h per Job, minimum 28800.
DEADLINE=${AWAI_VIRTIO_DEADLINE_SECONDS:-28800}
if ! [[ $DEADLINE =~ ^[0-9]+$ ]] || (( DEADLINE < MIN_DEADLINE_SECONDS )); then
  echo "AWAI4089_REFUSES: AWAI_VIRTIO_DEADLINE_SECONDS must be >= $MIN_DEADLINE_SECONDS (8h per Job; got '${DEADLINE}')." >&2
  exit 2
fi

# Feed URL: required env, no default (even for dry-run printing).
if [[ -z ${AWAI_FEED_URL:-} ]]; then
  echo "AWAI4089_REFUSES: AWAI_FEED_URL is required (feed URL must come from the environment; no default)." >&2
  exit 2
fi

# Kit URL/sha are required to execute (approved mode only).
if (( APPROVED )) && { [[ -z ${KIT_URL:-} ]] || [[ -z ${KIT_SHA256:-} ]]; }; then
  echo "AWAI4089_REFUSES: KIT_URL and KIT_SHA256 are required to execute (operator provides the kit)." >&2
  exit 2
fi
# Pool label feeds B2 artifact paths; required to execute.
if (( APPROVED )) && [[ -z ${AWAI_POOL_LABEL:-} ]]; then
  echo "AWAI4089_REFUSES: AWAI_POOL_LABEL is required to execute (B2 pool label for artifact paths)." >&2
  exit 2
fi
POOL=${AWAI_POOL_LABEL:-<pool>}
if (( APPROVED )); then :; fi

# Validate the pinned manifest input before anything else.
actual=$(shasum -a 256 "$MANIFEST_FILE" | awk '{print $1}')
if [[ $actual != "$EXPECTED_MANIFEST_SHA256" ]]; then
  echo "AWAI4089_REFUSES: pinned manifest SHA-256 differs: got $actual want $EXPECTED_MANIFEST_SHA256" >&2
  exit 1
fi
printf 'AWAI4089_MANIFEST_SHA256_VALIDATED %s %s\n' "$EXPECTED_MANIFEST_SHA256" "$MANIFEST_FILE"
printf 'AWAI4089_RELEASE_TYPE=%s AWAI4089_DEADLINE_SECONDS=%s AWAI4089_APPROVED=%s\n' \
  "$RELEASE_TYPE" "$DEADLINE" "$APPROVED"

stage() { printf 'AWAI4089_STAGE=%s %s\n' "$1" "$(date -u +%FT%TZ)"; }

# run: print (dry-run, with [dry-run] prefix; approved, no prefix) or execute.
run() {
  if (( APPROVED )); then
    printf '%s\n' "$*"
  else
    printf '[dry-run] %s\n' "$*"
  fi
  if (( APPROVED )); then
    "$@"
  fi
}

# Toolchain + kit fetch (verified before use).
run apt-get -qq update
run apt-get -qq install -y bc bison build-essential ca-certificates ccache cmake curl flex g++-multilib gcc-multilib git git-lfs gperf imagemagick lib32readline-dev lib32z1-dev libclang-18-dev libegl1 libelf-dev libglvnd-dev liblapack-dev liblz4-tool libopenblas-dev libpam-pwquality libsdl1.2-dev libssl-dev libxml2 libxml2-utils lz4 lzop ninja-build pkg-config python-is-python3 python3-dev python3-jsonschema python3-mako python3-packaging python3-pip python3-pycparser python3-ply python3-yaml rclone rsync schedtool squashfs-tools unzip xorriso xsltproc zip zstd
run mkdir -p "$KIT" "$BUILD_WORK_DIR/bin" "$UP/v1"
run curl -fsSL https://storage.googleapis.com/git-repo-downloads/repo -o "$BUILD_WORK_DIR/bin/repo"
run chmod a+x "$BUILD_WORK_DIR/bin/repo"
run curl -fsSL "${KIT_URL:-<KIT_URL>}" -o "$BUILD_WORK_DIR/kit.tar.gz"
run python3 -c 'import hashlib,sys; d=hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest(); sys.exit(0 if d==sys.argv[2] else 1)' "$BUILD_WORK_DIR/kit.tar.gz" "${KIT_SHA256:-<KIT_SHA256>}"
run tar -xzf "$BUILD_WORK_DIR/kit.tar.gz" -C "$KIT"
export PATH="$KIT/pc-ab-device:$BUILD_WORK_DIR/bin:$SRC/out/host/linux-x86/bin:$PATH"

# Sync (printed, not run, under DRY_RUN; sync cannot update the pinned manifest).
run repo init -u https://github.com/LineageOS/android.git -b lineage-24.0 --no-clone-bundle
run cp "$MANIFEST_FILE" "$SRC/.repo/manifests/default.xml"
run repo sync -m default.xml --no-manifest-update -c --no-clone-bundle --optimized-fetch -j4
run repo manifest -r -o "$UP/pinned-manifest.xml"
run python3 "$here/check-manifest-revisions.py" "$MANIFEST_FILE" "$UP/pinned-manifest.xml"
stage sync

# Repo's own apply tools, in repo order. No second explicit list.
run apply.sh "$SRC"
run apply-shipping-debug-lockdown.sh "$SRC"
run pc-firmware.py prepare "$SRC" "$FIRMWARE_GIT"
run updater-feed.py configure-release "$SRC/packages/apps/Updater" "$AWAI_FEED_URL"
stage patches

# Lunch + v1 build + v1 upload (BEFORE v2; failure in v2 keeps v1).
run bash -c "cd '$SRC' && source build/envsetup.sh && breakfast lineage_virtio_x86_64 $RELEASE_TYPE"
run m target-files-package otatools diskimage-vda
run cp "$TF_V1_SRC" "$UP/v1/virtio-target-files-v1.zip"
run make-tf-disk.sh "$UP/v1/virtio-target-files-v1.zip" "$PRODUCT_OUT/disk-vda.img" "$UP/v1/virtio-install-image.img"
run rclone copy "$UP/v1" art:awai-os-release-artifacts/awai-virtio-g2/${POOL}/v1/
stage v1-upload

# v2 rebuild (BUILD_NUMBER change; precedent ~336s) + real OTA.
run env BUILD_NUMBER=awai-virtio-g2-v2 BUILD_DATETIME="$(date +%s)" m target-files-package
stage v2-build
run cp "$TF_V1_SRC" "$UP/virtio-target-files.zip"
run ota_from_target_files -k "$TESTKEY" "$TF_V1_SRC" "$UP/virtio-full-ota.zip"
run ota_from_target_files -k "$TESTKEY" -i "$UP/v1/virtio-target-files-v1.zip" "$TF_V1_SRC" "$UP/virtio-incremental-ota.zip"
stage ota

# Collect: install image, manifest.json + SHA256SUMS, B2 upload, restore verify.
run cp "$UP/v1/virtio-install-image.img" "$UP/virtio-install-image.img"
run python3 -c 'import hashlib,json,os,sys; d=lambda p: (os.path.getsize(p), hashlib.sha256(open(p,"rb").read()).hexdigest()); root,out=sys.argv[1],sys.argv[2]; names=sys.argv[3:]; man={"prefix":"awai-virtio-g2/<pool>/","objects":[{"path":n,"size":d(os.path.join(root,n))[0],"sha256":d(os.path.join(root,n))[1]} for n in names]}; open(out,"w").write(json.dumps(man,indent=1))' "$UP" "$UP/manifest.json" virtio-target-files.zip virtio-install-image.img virtio-full-ota.zip virtio-incremental-ota.zip pinned-manifest.xml
run bash -c 'cd '"$UP"' && sha256sum virtio-target-files.zip virtio-install-image.img virtio-full-ota.zip virtio-incremental-ota.zip pinned-manifest.xml manifest.json > SHA256SUMS'
run rclone copy "$UP" art:awai-os-release-artifacts/awai-virtio-g2/${POOL}/
stage upload
run rclone copy art:awai-os-release-artifacts/awai-virtio-g2/${POOL}/ "$BUILD_WORK_DIR/restore/"
run python3 -c 'import hashlib,json,os,sys; root=sys.argv[1]; d=lambda p: (os.path.getsize(p), hashlib.sha256(open(p,"rb").read()).hexdigest()); man=json.load(open(os.path.join(root,"manifest.json"))); [print(n["path"], "ok" if (os.path.getsize(os.path.join(root,n["path"])), hashlib.sha256(open(os.path.join(root,n["path"]),"rb").read()).hexdigest())==(n["size"],n["sha256"]) else sys.exit(n["path"])) or sys.exit(0) for n in man["objects"]]' "$BUILD_WORK_DIR/restore"
run bash -c 'cd '"$BUILD_WORK_DIR/restore"' && sha256sum -c SHA256SUMS'
stage restore
printf 'AWAI4089_DONE approved=%s\n' "$APPROVED"
