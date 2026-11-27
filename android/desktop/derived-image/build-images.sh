#!/usr/bin/env bash
# Derived development images (AWAI-3067). Run as root on Linux with erofs-utils and attr.
# Inputs are the pinned PC Live images; they are mounted read-only and never modified.
# Output: system.img with the Awai apps as product apps, vendor.img with the DP-1
# primary-display property. Every other file keeps its content, mode, owner and xattrs.
set -euo pipefail
base=${1:?base image directory}; apks=${2:?APK directory}; out=${3:?new output directory}
here=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" = 0 ] || { echo 'run as root (ownership and security.* xattrs)' >&2; exit 2; }
[ ! -e "$out" ] || { echo "output exists: $out" >&2; exit 2; }
command -v mkfs.erofs >/dev/null && command -v setfattr >/dev/null

# Base pins: the same digests verify-images.sh requires for the persistence route.
check() { [ "$(sha256sum "$1" | cut -d ' ' -f 1)" = "$2" ] || { echo "pin mismatch: $1" >&2; exit 3; }; }
check "$base/system.img" 4c95555125385e1091183d4d8a8b4bdbd8c2a83b34ab56c4a180d9142588ae56
check "$base/vendor.img" de90b3edef88f547e2eab90821764a9eee8c1f528da622284220544d6235b2ca

# App name, APK file name in $apks. Placed under /system/product/app like the base's own apps.
# AWAI-4094: preinstall Home and Store only; Yotei and every other app come from the Store.
apps="AwaiHome:home-v15.apk AwaiStore:store-v15.apk"
for spec in $apps; do [ -f "$apks/${spec#*:}" ] || { echo "missing APK ${spec#*:}" >&2; exit 3; }; done

mkdir -m 700 "$out"; work=$(mktemp -d /var/tmp/awai-derived.XXXXXX)
cleanup() { umount "$work/m-system" "$work/m-vendor" 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT
mkdir "$work/m-system" "$work/m-vendor"
mount -t erofs -o loop,ro "$base/system.img" "$work/m-system"
mount -t erofs -o loop,ro "$base/vendor.img" "$work/m-vendor"
cp -a --preserve=all "$work/m-system" "$work/system"
cp -a --preserve=all "$work/m-vendor" "$work/vendor"

label=u:object_r:system_file:s0
[ "$(getfattr --only-values -n security.selinux "$work/system/system/product/app")" = "$label" ]
for spec in $apps; do
  name=${spec%%:*}; dir="$work/system/system/product/app/$name"
  [ ! -e "$dir" ] || { echo "app directory already exists in base: $name" >&2; exit 3; }
  install -d -m 0755 -o 0 -g 0 "$dir"
  install -m 0644 -o 0 -g 0 "$apks/${spec#*:}" "$dir/$name.apk"
  setfattr -n security.selinux -v "$label" "$dir" "$dir/$name.apk"
done

prop="$work/vendor/build.prop"
! grep -q '^vendor.hwc.drm.primary_display=' "$prop" || { echo 'property already set in base' >&2; exit 3; }
printf '\n# Awai derived development image (AWAI-3067)\nvendor.hwc.drm.primary_display=DP-1\n' >> "$prop"

# Same block size and LZ4HC compression family as the base; fixed timestamp and the base UUIDs.
build() {
  local name=$1 src=$2 uuid
  uuid=$(dump.erofs -s "$base/$name.img" | awk '/UUID/{print $NF}')
  mkfs.erofs -b4096 -zlz4hc -T 1792512299 -U "$uuid" --mount-point=/ "$out/$name.img" "$src" >/dev/null
}
build system "$work/system"; build vendor "$work/vendor"
for f in kernel ramdisk-all-combined.img system_dlkm.img vendor_dlkm.img firmware.img; do cp --preserve=mode "$base/$f" "$out/$f"; done

# Compare the trees: only the added app files and the vendor build.prop may differ.
mkdir "$work/n-system" "$work/n-vendor"
mount -t erofs -o loop,ro "$out/system.img" "$work/n-system"
mount -t erofs -o loop,ro "$out/vendor.img" "$work/n-vendor"
python3 "$here/compare-trees.py" "$work/m-system" "$work/n-system" > "$out/system-diff.json"
python3 "$here/compare-trees.py" "$work/m-vendor" "$work/n-vendor" > "$out/vendor-diff.json"
umount "$work/n-system" "$work/n-vendor"
sha256sum "$out"/*.img "$out/kernel" | sed "s#$out/##" > "$out/SHA256SUMS"
echo AWAI_DERIVED_IMAGES_READY
