#!/bin/sh
# AWAI-3839: rebuild Murakumo's native libraries from the pinned sources and
# compare every byte with apps/murakumo/native-pins.json. This is the step of
# .tatara/pipeline-native.edn (android-v1 toolchain lane): it needs cmake,
# make, python3 and the pinned NDK (ANDROID_NDK_HOME, or NDK_HOME from the
# runner). Network use is only the pinned source archives, fetched through
# the lane's egress proxy and digest-checked by the build scripts.
#
# The image engine is compared but not yet pinned (AWAI-3840): this run's
# receipts print the Linux SHA-256 to pin from.
set -eu
cd "$(dirname "$0")/../.."
export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-${NDK_HOME:?NDK_HOME or ANDROID_NDK_HOME must name the pinned NDK}}"
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

python3 apps/murakumo/scripts/build-native.py --out "$out/native" arm64-v8a x86_64
python3 apps/murakumo/scripts/build-image-native.py arm64-v8a x86_64
for abi in arm64-v8a x86_64; do
  cp "apps/murakumo/src-tauri/gen/android/app/src/main/jniLibs/$abi/libawai_diffusion.so" "$out/native/$abi/"
done
python3 apps/murakumo/scripts/verify-native-pins.py --dir "$out/native"

echo "image engine receipts (pin candidates until AWAI-3840 lands them):"
cat .agent-output/image-native-arm64-v8a.json .agent-output/image-native-x86_64.json
