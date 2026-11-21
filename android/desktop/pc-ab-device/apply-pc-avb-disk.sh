#!/bin/sh
# Apply the opt-in PC A/B disk layout to the dedicated virt-common checkout.
set -eu

src=${1:?usage: apply-pc-avb-disk.sh <source tree root>}
project="$src/device/virt/virt-common"
here=$(cd "$(dirname "$0")" && pwd)
patch="$here/patches/virt-common-awai-vbmeta-stock.patch"

if git -C "$project" apply --reverse --check "$patch" 2>/dev/null; then
    printf '%s\n' 'PC vbmeta stock disk configuration already applied'
else
    git -C "$project" apply --check "$patch"
    git -C "$project" apply "$patch"
    printf '%s\n' 'PC vbmeta stock disk configuration applied'
fi
