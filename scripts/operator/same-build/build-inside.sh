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
mkdir -p "$SRC" "$UP" /root/build/bin
stage() { printf 'AWAI3850_STAGE=%s %s\n' "$1" "$(date -u +%FT%TZ)"; }

stage toolchain
curl -fsSL https://storage.googleapis.com/git-repo-downloads/repo > /root/build/bin/repo
chmod a+x /root/build/bin/repo
export PATH="/root/build/bin:$PATH"
git config --global user.email same-build@awai.network
git config --global user.name "Awai same-build"
git config --global color.ui false

stage sync
cd "$SRC"
repo init -u https://github.com/LineageOS/android.git -b lineage-24.0 --no-clone-bundle
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

stage generic-fix
dev="$SRC/device/mainline/generic"
if ! grep -q -- '--header_version $(BOARD_BOOT_HEADER_VERSION)' "$dev/BoardConfig.mk"; then
  git -C "$dev" apply --check "$KIT/inputs/mkbootimg-header-version.patch"
  git -C "$dev" apply "$KIT/inputs/mkbootimg-header-version.patch"
fi

source build/envsetup.sh
stage breakfast-lamu
breakfast lamu userdebug
stage breakfast-generic
breakfast Generic_x86_64 userdebug
# Snapshot of record: after roomservice pulled device dependencies.
repo manifest -r -o "$UP/pinned-manifest.xml"
sha256sum "$UP/pinned-manifest.xml" > "$UP/pinned-manifest.xml.sha256"
repo forall -c 'echo "$REPO_PATH $REPO_LREV"' > "$UP/source-revisions.txt" || true

stage build-lamu
breakfast lamu userdebug
m -j"$(nproc)" otapackage 2>&1 | tee /root/build/build-lamu.log
lamu_out="$SRC/out/target/product/lamu"
ls "$lamu_out"/*.zip "$lamu_out"/boot.img >/dev/null

stage build-generic
breakfast Generic_x86_64 userdebug
m -j"$(nproc)" target-files-package otatools liveisoimage 2>&1 | tee /root/build/build-generic.log
gen_out="$SRC/out/target/product/Generic_x86_64"
ls "$gen_out"/*-live.iso >/dev/null
# The physical PC needs AMD firmware in the vendor image; fail loudly if absent.
unzip -l "$gen_out"/obj/PACKAGING/target_files_intermediates/*target_files.zip | grep -q 'amdgpu' || {
  echo "AWAI3850_ERROR: no amdgpu firmware in Generic target-files" >&2; exit 1; }

stage collect
mkdir -p "$UP/files"
cp "$UP/pinned-manifest.xml" "$UP/pinned-manifest.xml.sha256" "$UP/source-revisions.txt" "$UP/files/"
cp /root/build/build-lamu.log /root/build/build-generic.log "$UP/files/"
cp "$lamu_out"/lineage-*.zip "$UP/files/lamu-ota.zip"
( cd "$lamu_out" && tar -cf "$UP/files/lamu-images.tar" \
    boot.img init_boot.img vendor_boot.img dtbo.img vbmeta.img vbmeta_system.img \
    system.img system_ext.img product.img vendor.img vendor_dlkm.img system_dlkm.img 2>/dev/null || \
  tar -cf "$UP/files/lamu-images.tar" boot.img system.img vendor.img )
cp "$gen_out"/*-live.iso "$UP/files/generic-live.iso"
cp "$gen_out"/obj/PACKAGING/target_files_intermediates/*target_files.zip "$UP/files/generic-target-files.zip"
cp "$gen_out/kernel" "$UP/files/generic-kernel"
cp "$gen_out/ramdisk-all-combined.img" "$UP/files/generic-ramdisk.img"
for d in lamu Generic_x86_64; do
  unzip -p "$SRC/out/target/product/$d/obj/PACKAGING/target_files_intermediates/"*target_files.zip \
    SYSTEM/build.prop > "$UP/files/build-prop-$d.txt" 2>/dev/null || \
  cp "$SRC/out/target/product/$d/system/build.prop" "$UP/files/build-prop-$d.txt" || true
done
( cd "$UP/files" && sha256sum -- * > SHA256SUMS )

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
