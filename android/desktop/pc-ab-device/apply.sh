#!/bin/sh
# AWAI-3586: apply the Awai PC A/B patches to a LineageOS source tree.
# Usage: apply.sh <source tree root>
set -eu
src=${1:?usage: apply.sh <source tree root>}
here=$(cd "$(dirname "$0")" && pwd)
virtio="$src/device/virt/virtio-common"
checkpoint_patch="$here/patches/virtio-userdata-ext4-checkpoint.patch"
wait_patch="$here/patches/virtio-userdata-ext4-checkpoint-wait.patch"

select_fstab_patch() {
  for candidate in virtio-userdata.patch virtio-userdata-block-checkpoint.patch; do
    patch="$here/patches/$candidate"
    if git -C "$virtio" apply --reverse --check "$patch" 2>/dev/null; then
      return 0
    fi
    if git -C "$virtio" apply --check "$patch" 2>/dev/null; then
      echo "$patch"
      return 0
    fi
  done
  echo "virtio-common: unsupported userdata fstab; cannot preserve existing mount options" >&2
  return 1
}

fstab_patch=
if git -C "$virtio" apply --reverse --check "$wait_patch" 2>/dev/null; then
  userdata_wait_applied=true
else
  userdata_wait_applied=false
  fstab_patch=$(select_fstab_patch)
fi

one() { # <project path> <patch> <marker text that the patch adds>
  dir="$src/$1"; patch="$here/patches/$2"
  [ -d "$dir" ] || { echo "no $dir" >&2; exit 1; }
  if grep -rqF --include='*.cfg' --include='*contexts' --include='*.mk' -- "$3" "$dir" 2>/dev/null; then echo "$1: already applied"; return; fi
  git -C "$dir" apply --check "$patch"
  git -C "$dir" apply "$patch"
  echo "$1: applied"
}
one device/virt/virtio-common virtio-common-awai-pc.patch 'AWAI-3586: label partitions by GPT name'
one device/virt/virt-common virt-common-awai-pc.patch 'awai_find_part'

if [ -n "$fstab_patch" ]; then
  git -C "$virtio" apply "$fstab_patch"
  echo "virtio-common userdata fstab: applied"
else
  echo "virtio-common userdata fstab: already applied"
fi

if [ "$userdata_wait_applied" = false ]; then
  # The older fstab selects ext4 on a blank NVMe but has no data checkpoint.
  if ! git -C "$virtio" apply --reverse --check "$checkpoint_patch" 2>/dev/null; then
    git -C "$virtio" apply --check "$checkpoint_patch"
    git -C "$virtio" apply "$checkpoint_patch"
    echo "virtio-common ext4 userdata checkpoint: enabled"
  fi
  # fs_mgr creates dm-bow before mounting. Wait for its device node to appear.
  git -C "$virtio" apply --check "$wait_patch"
  git -C "$virtio" apply "$wait_patch"
  echo "virtio-common ext4 userdata checkpoint device wait: enabled"
fi

# The vendor patches apply only in the source checkout prepared for Awai PC.
vendor="$src/vendor/lineage"
for name in vendor-lineage-no-ota-downgrade.patch vendor-lineage-kernel-output-prefix.patch; do
  patch="$here/patches/$name"
  if git -C "$vendor" apply --reverse --check "$patch" 2>/dev/null; then
    echo "vendor/lineage $name: already applied"
  else
    git -C "$vendor" apply --check "$patch"
    git -C "$vendor" apply "$patch"
    echo "vendor/lineage $name: applied"
  fi
done
