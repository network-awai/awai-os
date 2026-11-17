#!/bin/sh
# Create a key disk for the base check image: a tar archive with a new random
# LUKS key and the given age key, and optionally a restic repository key for
# backup.nix. The test keys are for local VMs only.
#
# usage: base-make-key-disk.sh <age-key-file> <output.tar> [restic-key-file]
# exit:  0 written
#        3 could not run
set -u

age_key=${1:-}
out=${2:-}
restic_key=${3:-}

[ -f "$age_key" ] || { echo "NOT_RUN no age key: $age_key"; exit 3; }
[ -n "$out" ] || { echo "NOT_RUN no output path"; exit 3; }
[ -z "$restic_key" ] || [ -f "$restic_key" ] || { echo "NOT_RUN no restic key: $restic_key"; exit 3; }

dir=$(mktemp -d /tmp/otehon-key.XXXXXX) || { echo "NOT_RUN no temp directory"; exit 3; }
trap 'rm -rf "$dir"' EXIT

head -c 64 /dev/urandom > "$dir/luks.key"
cp "$age_key" "$dir/age.key"
set -- luks.key age.key
if [ -n "$restic_key" ]; then
  cp "$restic_key" "$dir/restic.key"
  set -- "$@" restic.key
fi
COPYFILE_DISABLE=1 tar --format ustar -cf "$out" -C "$dir" "$@" || {
  echo "NOT_RUN tar failed"
  exit 3
}
