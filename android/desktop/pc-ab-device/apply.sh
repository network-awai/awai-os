#!/bin/sh
# AWAI-3586: apply the Awai PC A/B patches to a LineageOS source tree.
# Usage: apply.sh <source tree root>
set -eu
src=${1:?usage: apply.sh <source tree root>}
here=$(cd "$(dirname "$0")" && pwd)
one() { # <project path> <patch> <marker text that the patch adds>
  dir="$src/$1"; patch="$here/patches/$2"
  [ -d "$dir" ] || { echo "no $dir" >&2; exit 1; }
  if grep -rqF -- "$3" "$dir" --include='*.cfg' --include='*contexts' --include='*.mk' 2>/dev/null; then echo "$1: already applied"; return; fi
  git -C "$dir" apply --check "$patch"
  git -C "$dir" apply "$patch"
  echo "$1: applied"
}
one device/virt/virtio-common virtio-common-awai-pc.patch 'AWAI-3586: label partitions by GPT name'
one device/virt/virt-common virt-common-awai-pc.patch 'awai_find_part'

# The vendor patch applies only in the source checkout prepared for Awai PC.
vendor="$src/vendor/lineage"
patch="$here/patches/vendor-lineage-no-ota-downgrade.patch"
if git -C "$vendor" apply --reverse --check "$patch" 2>/dev/null; then
    echo "vendor/lineage: already applied"
else
    git -C "$vendor" apply --check "$patch"
    git -C "$vendor" apply "$patch"
    echo "vendor/lineage: applied"
fi
