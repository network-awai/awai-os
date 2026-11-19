#!/bin/sh
# AWAI-3061: apply the target-files fix to a LineageOS source tree.
# Usage: apply.sh <source tree root>
set -eu
src=${1:?usage: apply.sh <source tree root>}
here=$(cd "$(dirname "$0")" && pwd)
dev="$src/device/mainline/generic"
[ -f "$dev/BoardConfig.mk" ] || { echo "no $dev/BoardConfig.mk" >&2; exit 1; }
if grep -q -- '--header_version \$(BOARD_BOOT_HEADER_VERSION)' "$dev/BoardConfig.mk"; then
  echo "already applied"; exit 0
fi
git -C "$dev" apply --check "$here/mkbootimg-header-version.patch"
git -C "$dev" apply "$here/mkbootimg-header-version.patch"
echo "applied to $dev"
