#!/bin/sh
# Create a key disk for the base check image: a tar archive with a new random
# LUKS key and the given age key. The test keys are for local VMs only.
#
# usage: base-make-key-disk.sh <age-key-file> <output.tar>
# exit:  0 written
#        3 could not run
set -u

age_key=${1:-}
out=${2:-}

[ -f "$age_key" ] || { echo "NOT_RUN no age key: $age_key"; exit 3; }
[ -n "$out" ] || { echo "NOT_RUN no output path"; exit 3; }

dir=$(mktemp -d /tmp/otehon-key.XXXXXX) || { echo "NOT_RUN no temp directory"; exit 3; }
trap 'rm -rf "$dir"' EXIT

head -c 64 /dev/urandom > "$dir/luks.key"
cp "$age_key" "$dir/age.key"
COPYFILE_DISABLE=1 tar --format ustar -cf "$out" -C "$dir" luks.key age.key || {
  echo "NOT_RUN tar failed"
  exit 3
}
