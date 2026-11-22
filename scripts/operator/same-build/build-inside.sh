#!/usr/bin/env bash
# AWAI-3850: build lamu and Generic_x86_64 from one pinned Lineage snapshot.
# Runs inside the VKE build Job. Uploads every output to the B2 prefix in
# $AWAI_ARTIFACT_PREFIX. Development (testkey) signing only; not a production
# release. Device-specific kernel/vendor/firmware stay device-specific.
set -euo pipefail
SRC=${SRC:-/root/build/src}
KIT=${KIT:-/root/build/kit/same-build}
UP=${UP:-/root/build/upload}
export USE_CCACHE=1 CCACHE_DIR=${CCACHE_DIR:-/root/build/ccache}
export CCACHE_MAXSIZE=${CCACHE_MAXSIZE:-50G} CCACHE_COMPRESS=true
TARGETS=${TARGETS:-lamu,generic}
CACHE_PREFIX=${CACHE_PREFIX:-awai-same-build-cache/v1}
# Parallelism is bounded by memory, not cores: large links spike past 4 GiB/job.
mem_gb=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) / 1024 / 1024 ))
JOBS=$(( $(nproc) < mem_gb / 4 ? $(nproc) : mem_gb / 4 ))
(( JOBS < 1 )) && JOBS=1
mkdir -p "$SRC" "$UP" /root/build/bin
stage() { printf 'AWAI3850_STAGE=%s %s\n' "$1" "$(date -u +%FT%TZ)"; }

stage toolchain
curl -fsSL https://storage.googleapis.com/git-repo-downloads/repo > /root/build/bin/repo
chmod a+x /root/build/bin/repo
export PATH="/root/build/bin:$PATH"
git config --global user.email same-build@awai.network
git config --global user.name "Awai same-build"
git config --global color.ui false

stage cache-restore
# Content-addressed caches are safe to restore for any snapshot: the build
# still syncs to the pinned branch and verifies the recorded manifest.
if rclone lsf "art:$AWAI_ARTIFACT_BUCKET/$CACHE_PREFIX/" 2>/dev/null | grep -qx cache.json; then
  mkdir -p /root/build/cache-dl
  rclone copy "art:$AWAI_ARTIFACT_BUCKET/$CACHE_PREFIX/" /root/build/cache-dl -q --transfers 2 || true
  if [[ -s /root/build/cache-dl/src.tar.zst ]]; then
    ( cd /root/build && zstd -dc cache-dl/src.tar.zst | tar -xf - ) || true
  fi
  if [[ -s /root/build/cache-dl/ccache.tar.zst ]]; then
    mkdir -p "$CCACHE_DIR"
    ( cd "$CCACHE_DIR" && zstd -dc /root/build/cache-dl/ccache.tar.zst | tar -xf - ) || true
  fi
  echo "AWAI3850_CACHE_RESTORED $(cat /root/build/cache-dl/cache.json 2>/dev/null || echo unknown)"
else
  echo "AWAI3850_CACHE_MISS"
fi

stage sync
cd "$SRC"
repo init -u https://github.com/LineageOS/android.git -b lineage-24.0 --no-clone-bundle
# The Generic PC device tree is not in the default lineage-24.0 manifest.
mkdir -p .repo/local_manifests
cat > .repo/local_manifests/awai-generic.xml <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<manifest>
  <remote name="themuppets" fetch="https://github.com/TheMuppets/" />
  <project name="LineageOS/android_device_mainline_generic" path="device/mainline/generic"
           remote="github" revision="3d402dc58aa2086a960abd076204836259387a79" />
  <project name="LineageOS/android_device_mainline_common" path="device/mainline/common"
           remote="github" revision="lineage-24.0" />
  <project name="LineageOS/android_external_tinyhal" path="external/tinyhal"
           remote="github" revision="lineage-24.0" />
  <project name="LineageOS/android_kernel_mainline_configs" path="kernel/mainline/configs"
           remote="github" revision="lineage-24.0" />
  <project name="LineageOS/android_prebuilts_bootmgr" path="prebuilts/bootmgr"
           remote="github" revision="lineage-24.0" />
  <project name="LineageOS/android_external_drm_hwcomposer-upstream" path="external/drm_hwcomposer-upstream"
           remote="github" revision="lineage-24.0" />
  <project name="LineageOS/android_external_minigbm-upstream" path="external/minigbm-upstream"
           remote="github" revision="lineage-24.0" />
  <project name="LineageOS/android_external_linux-firmware-mainline" path="external/linux-firmware-mainline"
           remote="github" revision="lineage-24.0" />
  <project name="LineageOS/android_external_mesa" path="external/mesa"
           remote="github" revision="lineage-24.0" />
  <project name="LineageOS/android_hardware_mainline_common" path="hardware/mainline/common"
           remote="github" revision="lineage-24.0" />
  <project name="LineageOS/android_vendor_mainline" path="vendor/mainline"
           remote="github" revision="lineage-24.0" />
  <project name="proprietary_vendor_motorola_lamu" path="vendor/motorola/lamu"
           remote="themuppets" revision="lineage-24.0" />
  <project name="proprietary_vendor_motorola_mt6768-common" path="vendor/motorola/mt6768-common"
           remote="themuppets" revision="lineage-24.0" />
</manifest>
EOF
repo sync -c --no-clone-bundle --optimized-fetch -j"$(nproc)" || \
  repo sync -c --no-clone-bundle --optimized-fetch -j4
repo manifest -r -o "$UP/pinned-manifest-initial.xml"

stage wizard
wizard="$SRC/packages/apps/SetupWizard"
git -C "$wizard" checkout d995f1a1949f5988850c9977658e2590efe502b4 2>/dev/null || {
  git -C "$wizard" fetch origin d995f1a1949f5988850c9977658e2590efe502b4
  git -C "$wizard" checkout d995f1a1949f5988850c9977658e2590efe502b4
}
git -C "$wizard" apply --check "$KIT/inputs/setupwizard-awai.patch"
git -C "$wizard" apply "$KIT/inputs/setupwizard-awai.patch"
while IFS= read -r -d '' file; do
  target="$wizard/app/src/main/res/${file#"$KIT/inputs/res/"}"
  mkdir -p "$(dirname "$target")"; cp "$file" "$target"
done < <(find "$KIT/inputs/res" -type f -print0)
mkdir -p "$wizard/app/src/main/res/drawable-nodpi"
cp "$KIT/inputs/setup-logo.png" "$wizard/app/src/main/res/drawable-nodpi/awai_welcome_logo.png"

source build/envsetup.sh
stage breakfast-lamu
breakfast lamu userdebug
stage breakfast-generic
breakfast Generic_x86_64 userdebug

stage generic-fix
dev="$SRC/device/mainline/generic"
[[ -f "$dev/BoardConfig.mk" ]] || { echo "AWAI3850_ERROR: $dev missing after breakfast" >&2; exit 1; }
if ! grep -q -- '--header_version $(BOARD_BOOT_HEADER_VERSION)' "$dev/BoardConfig.mk"; then
  git -C "$dev" apply --check "$KIT/inputs/mkbootimg-header-version.patch"
  git -C "$dev" apply "$KIT/inputs/mkbootimg-header-version.patch"
fi
# Snapshot of record: after roomservice pulled device dependencies.
repo manifest -r -o "$UP/pinned-manifest.xml"
sha256sum "$UP/pinned-manifest.xml" > "$UP/pinned-manifest.xml.sha256"
repo forall -c 'echo "$REPO_PATH $REPO_LREV"' > "$UP/source-revisions.txt" || true

lamu_out="$SRC/out/target/product/lamu"
gen_out="$SRC/out/target/product/Generic_x86_64"
if [[ ",$TARGETS," = *",lamu,"* ]]; then
  stage build-lamu
  breakfast lamu userdebug
  m -j"$JOBS" otapackage 2>&1 | tee /root/build/build-lamu.log
  ls "$lamu_out"/lineage-*.zip "$lamu_out"/boot.img >/dev/null
fi
if [[ ",$TARGETS," = *",generic,"* ]]; then
  stage build-generic
  breakfast Generic_x86_64 userdebug
  m -j"$JOBS" target-files-package otatools liveisoimage 2>&1 | tee /root/build/build-generic.log
  ls "$gen_out"/*-live.iso >/dev/null
  # The physical PC needs AMD firmware in the vendor image; fail loudly if absent.
  unzip -l "$gen_out"/obj/PACKAGING/target_files_intermediates/*target_files.zip | grep -q 'amdgpu' || {
    echo "AWAI3850_ERROR: no amdgpu firmware in Generic target-files" >&2; exit 1; }
fi
ccache -s > "$UP/ccache-stats.txt" 2>/dev/null || true

stage collect
mkdir -p "$UP/files"
cp "$UP/pinned-manifest.xml" "$UP/pinned-manifest.xml.sha256" "$UP/source-revisions.txt" "$UP/files/"
cp "$UP/ccache-stats.txt" "$UP/files/" 2>/dev/null || true
if [[ ",$TARGETS," = *",lamu,"* ]]; then
  cp /root/build/build-lamu.log "$UP/files/"
  cp "$lamu_out"/lineage-*.zip "$UP/files/lamu-ota.zip"
  ( cd "$lamu_out" && tar -cf "$UP/files/lamu-images.tar" \
      boot.img init_boot.img vendor_boot.img dtbo.img vbmeta.img vbmeta_system.img \
      system.img system_ext.img product.img vendor.img vendor_dlkm.img system_dlkm.img 2>/dev/null || \
    tar -cf "$UP/files/lamu-images.tar" boot.img system.img vendor.img )
fi
if [[ ",$TARGETS," = *",generic,"* ]]; then
  cp /root/build/build-generic.log "$UP/files/"
  cp "$gen_out"/*-live.iso "$UP/files/generic-live.iso"
  cp "$gen_out"/obj/PACKAGING/target_files_intermediates/*target_files.zip "$UP/files/generic-target-files.zip"
  cp "$gen_out/kernel" "$UP/files/generic-kernel"
  cp "$gen_out/ramdisk-all-combined.img" "$UP/files/generic-ramdisk.img"
fi
for d in lamu Generic_x86_64; do
  unzip -p "$SRC/out/target/product/$d/obj/PACKAGING/target_files_intermediates/"*target_files.zip \
    SYSTEM/build.prop > "$UP/files/build-prop-$d.txt" 2>/dev/null || \
  cp "$SRC/out/target/product/$d/system/build.prop" "$UP/files/build-prop-$d.txt" 2>/dev/null || true
done
( cd "$UP/files" && sha256sum -- * > SHA256SUMS )

stage cache-save
# Keep at most the current generation; the key has no delete scope, so old
# generations are retired by changing CACHE_PREFIX (see README).
mkdir -p /root/build/cache-up
( cd "$CCACHE_DIR" && tar -cf - . | zstd -q -T"$(nproc)" -3 -c > /root/build/cache-up/ccache.tar.zst )
( cd /root/build && tar --exclude='src/out' -cf - src | zstd -q -T"$(nproc)" -3 -c > /root/build/cache-up/src.tar.zst )
python3 - > /root/build/cache-up/cache.json <<'PYEOF'
import json, os, datetime
def size(name): return os.path.getsize("/root/build/cache-up/" + name)
manifest_sha = ""
try: manifest_sha = open("/root/build/upload/pinned-manifest.xml.sha256").read().split()[0]
except OSError: pass
print(json.dumps({"schema": "awai.same-build-cache.v1",
  "created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "pinnedManifestSha256": manifest_sha,
  "ccacheBytes": size("ccache.tar.zst"), "srcBytes": size("src.tar.zst")}, indent=1))
PYEOF
rclone copy /root/build/cache-up "art:$AWAI_ARTIFACT_BUCKET/$CACHE_PREFIX/" -q --transfers 2 --b2-chunk-size 96M --b2-upload-cutoff 200M || \
  echo "AWAI3850_CACHE_SAVE_FAILED (non-fatal)"
echo "AWAI3850_CACHE_SAVED"

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
manifest = {"schema": "awai.same-build-artifacts.v1", "prefix": sys.argv[1],
  "created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "objects": [entry("artifacts.tar.zst", "/root/build/upload")], "contents": contents}
print(json.dumps(manifest, indent=1))
PYEOF
cd "$UP"
rclone copy . "art:$AWAI_ARTIFACT_BUCKET/$AWAI_ARTIFACT_PREFIX/" -q --transfers 2 --b2-chunk-size 96M --b2-upload-cutoff 200M
printf 'AWAI3850_UPLOAD_OK %s\n' "$(date -u +%FT%TZ)"
touch /root/build/artifacts-ready
