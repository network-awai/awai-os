#!/bin/sh
# Apply the opt-in AOSP AVB build configuration to the dedicated PC checkout.
set -eu

src=${1:?usage: apply-pc-avb-build.sh <source tree root>}
board="$src/device/virt/virtio_x86_64"
here=$(cd "$(dirname "$0")" && pwd)
patch="$here/patches/virtio-x86-64-awai-avb-build.patch"

if git -C "$board" apply --reverse --check "$patch" 2>/dev/null; then
    printf '%s\n' 'PC AVB build configuration already applied'
else
    git -C "$board" apply --check "$patch"
    git -C "$board" apply "$patch"
    printf '%s\n' 'PC AVB build configuration applied'
fi
