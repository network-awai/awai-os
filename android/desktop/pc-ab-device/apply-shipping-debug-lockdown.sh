#!/bin/sh
# AWAI-3682: close the ADB routes a shipping (user) image must not have.
# Usage: apply-shipping-debug-lockdown.sh [--check] <source tree root>
#
# Run after apply.sh, on the same dedicated source checkout. apply.sh does not
# call this script: the patches have not been through a build or a boot yet
# (see README.md, "Shipping debug lockdown").
#
# --check reports what would happen and changes nothing.
# Every patch is checked before any is applied, so a tree that does not match
# is left untouched.
set -eu
check_only=false
if [ "${1:-}" = "--check" ]; then check_only=true; shift; fi
src=${1:?usage: apply-shipping-debug-lockdown.sh [--check] <source tree root>}
here=$(cd "$(dirname "$0")" && pwd)

# <project path> <patch>
set -- \
  device/virt/virt-common virt-common-user-no-adb-tcp.patch \
  device/mainline/common mainline-common-user-no-insecure-debugging.patch \
  build/make build-no-trade-in-mode-trigger.patch

state() { # prints applied | pending | mismatch
  if git -C "$1" apply --reverse --check "$2" 2>/dev/null; then echo applied
  elif git -C "$1" apply --check "$2" 2>/dev/null; then echo pending
  else echo mismatch; fi
}

failed=false
args="$*"
while [ $# -gt 0 ]; do
  dir="$src/$1"; patch="$here/patches/$2"
  if [ ! -d "$dir" ]; then echo "$1: no such project" >&2; failed=true; shift 2; continue; fi
  s=$(state "$dir" "$patch")
  echo "$1: $2: $s"
  [ "$s" = mismatch ] && failed=true
  shift 2
done
if [ "$failed" = true ]; then
  echo "nothing applied: at least one project does not match its patch" >&2
  exit 1
fi
[ "$check_only" = true ] && exit 0

# shellcheck disable=SC2086
set -- $args
while [ $# -gt 0 ]; do
  dir="$src/$1"; patch="$here/patches/$2"
  if [ "$(state "$dir" "$patch")" = pending ]; then
    git -C "$dir" apply "$patch"
    echo "$1: applied $2"
  fi
  shift 2
done
