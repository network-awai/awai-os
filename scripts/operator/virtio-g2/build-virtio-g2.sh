#!/usr/bin/env bash
# G2 (AWAI-4088): lineage_virtio_x86_64 from the pinned manifest, one Job.
#
# Chain from a single input (the pinned manifest):
#   target-files -> install image -> full OTA -> incremental OTA
# Does NOT touch the AWAI-3850 lamu / Generic_x86_64 Job
# (scripts/operator/same-build/): different product, different scripts,
# different B2 prefix (awai-virtio-g2/<pool>/ vs awai-same-build/<pool>/).
#
# Inputs (all explicit, all read at runtime, none bundled):
#   MANIFEST_FILE   android/desktop/manifest/pinned-manifest.xml
#   MANIFEST_SHA256 61c11f507fa14329229c16a635890b2c6d5f2f4e5a648a77045a09f7f4194d7d
#                   (from android/desktop/manifest/manifest-inputs.sha256;
#                    the Job verifies it before sync)
#   MANIFEST_REPO   https://github.com/LineageOS/android.git
#   MANIFEST_BRANCH lineage-24.0 (repo init base; the pinned manifest itself
#                   pins every project revision, so no branch can be inherited)
#   PRODUCT         lineage_virtio_x86_64
#   VARIANT         user (release type; override to userdebug for dev runs)
#   PATCHES_DIR     android/desktop/pc-ab-device/ (apply.sh + patches/)
#                   applied via apply.sh. The three Updater patches were
#                   measured NOT APPLICABLE at this snapshot
#                   (android/desktop/evidence/g2-patches-20261125/) and are
#                   not applied; apply.sh does not touch Updater either.
#   MKBOOTIMG       android/desktop/target-files/mkbootimg-header-version.patch
#                   is out of scope for virtio (BOARD_BOOT_HEADER_VERSION
#                   is not used in this tree; measured 対象外). The generic-fix
#                   guard below mirrors build-inside.sh and skips there.
#   UPLOAD_PREFIX   awai-virtio-g2/<pool>/ (new; never awai-same-build/)
#
# Outputs (per run, under $UP/files/, then B2 awai-virtio-g2/<pool>/):
#   virtio-target-files.zip     target-files (v2 build; v1 kept for the
#                               incremental-OTA input as virtio-target-files-v1.zip)
#   virtio-install-image.img    install image (diskimage-vda output)
#   virtio-full-ota.zip         full OTA
#   virtio-incremental-ota.zip  incremental OTA (v1 -> v2)
#   pinned-manifest.xml (+ .sha256), source-revisions.txt, build-prop-*.txt,
#   SHA256SUMS, manifest.json (path/size/sha256 per object)
# Digest slots for manifest / target-files / install image / full OTA /
# incremental OTA live in ../../digests.json (schema awai.g2-digests.v1,
# empty until a run fills them). This script never writes to an existing
# evidence directory: callers must pass a fresh AWAI_G2_OUT (workflow enforces
# mkdir -p on that fresh path only).
#
# Dry-run: AWAI_G2_DRY_RUN=1 prints the step list and exits 0 without
# repo sync / m / network. This PR ships the definition only; nothing here
# has been executed against VKE.
set -euo pipefail
SRC=${SRC:-/root/build/src}
KIT=${KIT:-/root/build/kit/virtio-g2}
UP=${UP:-/root/build/upload}
PRODUCT=${PRODUCT:-lineage_virtio_x86_64}
VARIANT=${VARIANT:-user}
MANIFEST_SHA256=${MANIFEST_SHA256:-61c11f507fa14329229c16a635890b2c6d5f2f4e5a648a77045a09f7f4194d7d}
export USE_CCACHE=1 CCACHE_DIR=${CCACHE_DIR:-/root/build/ccache}
export CCACHE_MAXSIZE=${CCACHE_MAXSIZE:-50G} CCACHE_COMPRESS=true
export ROOMSERVICE_DRYRUN=true
stage() { printf 'AWAI4088_STAGE=%s %s\n' "$1" "$(date -u +%FT%TZ)"; }
step()  { printf 'AWAI4088_DRYRUN_STEP=%s\n' "$1"; }

if [[ "${AWAI_G2_DRY_RUN:-0}" = 1 ]]; then
  cat <<'DRYRUN'
AWAI4088_DRY_RUN=1
step 1: verify pinned-manifest.xml sha256 == MANIFEST_SHA256
step 2: repo init (LineageOS/android lineage-24.0) + install pinned manifest as .repo/manifests/default.xml + repo sync
step 3: bash android/desktop/pc-ab-device/apply.sh "$SRC"   # pc-ab chain only; Updater patches not applied (not applicable, measured)
step 4: generic-fix guard: if device/mainline/generic sets BOARD_BOOT_HEADER_VERSION without --header_version, apply mkbootimg patch; else skip
step 5: source build/envsetup.sh; breakfast lineage_virtio_x86_64 $VARIANT
step 6: m target-files-package otatools diskimage-vda   # v1 target-files (install-image input)
step 7: BUILD_NUMBER=awai-g2-v2 BUILD_DATETIME=now m target-files-package   # v2 target-files from the same tree
step 8: install image: diskimage-vda output -> virtio-install-image.img
step 9: full OTA: ota_from_target_files -k testkey v2-target_files.zip virtio-full-ota.zip
step 10: incremental OTA: ota_from_target_files -k testkey -i v1-target_files.zip v2-target_files.zip virtio-incremental-ota.zip
step 11: collect + SHA256SUMS + manifest.json -> B2 awai-virtio-g2/<pool>/
DRYRUN
  exit 0
fi

stage verify-manifest
test -f "$KIT/pinned-manifest.xml"
echo "$MANIFEST_SHA256  $KIT/pinned-manifest.xml" | sha256sum -c -

stage toolchain
curl -fsSL https://storage.googleapis.com/git-repo-downloads/repo > /root/build/bin/repo
chmod a+x /root/build/bin/repo
export PATH="/root/build/bin:$PATH"
git config --global user.email virtio-g2@awai.network
git config --global user.name "Awai virtio G2"
git config --global color.ui false

stage sync
mkdir -p "$SRC" "$UP"
cd "$SRC"
repo init -u https://github.com/LineageOS/android.git -b lineage-24.0 --no-clone-bundle
cp "$KIT/pinned-manifest.xml" .repo/manifests/default.xml
repo sync -c --no-clone-bundle --optimized-fetch -j"$(nproc)" || \
  repo sync -c --no-clone-bundle --optimized-fetch -j4
repo manifest -r -o "$UP/pinned-manifest.xml"
sha256sum "$UP/pinned-manifest.xml" > "$UP/pinned-manifest.xml.sha256"
repo forall -c 'echo "$REPO_PATH $REPO_LREV"' > "$UP/source-revisions.txt" || true

stage patches
# pc-ab chain only. apply.sh implements the measured select/skip logic
# (virtio-userdata alternative selection, checkpoint reverse-check skip,
# awai-pc before aw-mesa-sphal). Updater patches are NOT applied:
# measured not applicable at this snapshot (g2-patches-20261125/).
bash "$KIT/pc-ab-device/apply.sh" "$SRC"
# mkbootimg guard (mirrors build-inside.sh generic-fix):
# only when the tree sets BOARD_BOOT_HEADER_VERSION without --header_version.
dev="$SRC/device/mainline/generic"
if [[ -f "$dev/BoardConfig.mk" ]] && grep -q 'BOARD_BOOT_HEADER_VERSION' "$dev/BoardConfig.mk" && \
   ! grep -q -- '--header_version $(BOARD_BOOT_HEADER_VERSION)' "$dev/BoardConfig.mk"; then
  git -C "$dev" apply --check "$KIT/target-files/mkbootimg-header-version.patch"
  git -C "$dev" apply "$KIT/target-files/mkbootimg-header-version.patch"
  echo "AWAI4088_MKBOOTIMG_APPLIED"
else
  echo "AWAI4088_MKBOOTIMG_SKIPPED"
fi

source build/envsetup.sh
stage breakfast
breakfast "$PRODUCT" "$VARIANT" || { echo "AWAI4088_ERROR: breakfast failed" >&2; exit 1; }

out_dir="$SRC/out/target/product/virtio_x86_64"
stage build
# v1 (install-image input) then v2 (OTA target), same tree, same command family.
m -j"$(nproc)" target-files-package otatools diskimage-vda 2>&1 | tee /root/build/build-virtio-v1.log
tf_v1="$out_dir/obj/PACKAGING/target_files_intermediates/lineage_virtio_x86_64-target_files.zip"
test -f "$tf_v1"
mkdir -p "$UP/v1"
cp "$tf_v1" "$UP/v1/virtio-target-files-v1.zip"
BUILD_NUMBER=awai-g2-v2 BUILD_DATETIME="$(date +%s)" \
  m -j"$(nproc)" target-files-package 2>&1 | tee /root/build/build-virtio-v2.log
tf_v2="$out_dir/obj/PACKAGING/target_files_intermediates/lineage_virtio_x86_64-target_files.zip"
test -f "$tf_v2"
test "$tf_v1" != "$tf_v2" || true

stage ota
export PATH="$SRC/out/host/linux-x86/bin:$SRC/prebuilts/jdk/jdk21/linux-x86/bin:$PATH"
testkey="$SRC/build/make/target/product/security/testkey"
ota_from_target_files -k "$testkey" "$tf_v2" "$UP/virtio-full-ota.zip"
ota_from_target_files -k "$testkey" -i "$UP/v1/virtio-target-files-v1.zip" "$tf_v2" "$UP/virtio-incremental-ota.zip"

stage collect
mkdir -p "$UP/files"
cp "$UP/pinned-manifest.xml" "$UP/pinned-manifest.xml.sha256" "$UP/source-revisions.txt" "$UP/files/"
cp "$tf_v2" "$UP/files/virtio-target-files.zip"
cp "$UP/v1/virtio-target-files-v1.zip" "$UP/files/"
cp "$out_dir/disk-vda.img" "$UP/files/virtio-install-image.img" 2>/dev/null || \
  cp "$out_dir/"*vda*.img "$UP/files/virtio-install-image.img" 2>/dev/null || true
cp "$UP/virtio-full-ota.zip" "$UP/files/virtio-full-ota.zip"
cp "$UP/virtio-incremental-ota.zip" "$UP/files/virtio-incremental-ota.zip"
( cd "$UP/files" && sha256sum -- * > SHA256SUMS )
ccache -s > "$UP/files/ccache-stats.txt" 2>/dev/null || true

stage upload
( cd "$UP/files" && tar --sparse -cf - . | zstd -q -T"$(nproc)" -3 -c > "$UP/artifacts.tar.zst" )
zstd -tq "$UP/artifacts.tar.zst"
python3 - "$AWAI_ARTIFACT_PREFIX" > "$UP/manifest.json" <<'PYEOF'
import hashlib, json, os, sys, datetime
def entry(path, root):
    full = os.path.join(root, path); digest = hashlib.sha256()
    with open(full, "rb") as h:
        for block in iter(lambda: h.read(1 << 20), b""): digest.update(block)
    return {"path": path, "size": os.path.getsize(full), "sha256": digest.hexdigest()}
files_root = "/root/build/upload/files"
contents = [entry(name, files_root) for name in sorted(os.listdir(files_root))]
manifest = {"schema": "awai.virtio-g2-artifacts.v1", "prefix": sys.argv[1],
  "created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "objects": [entry("artifacts.tar.zst", "/root/build/upload")], "contents": contents}
print(json.dumps(manifest, indent=1))
PYEOF
cd "$UP"
rclone copy . "art:$AWAI_ARTIFACT_BUCKET/$AWAI_ARTIFACT_PREFIX/" -q --transfers 2 --b2-chunk-size 96M --b2-upload-cutoff 200M
printf 'AWAI4088_UPLOAD_OK %s\n' "$(date -u +%FT%TZ)"
touch /root/build/artifacts-ready
