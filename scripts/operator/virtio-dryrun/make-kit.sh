#!/usr/bin/env bash
# AWAI-4089 (G2): build the Job kit tarball from a specific commit.
#
#   scripts/operator/virtio-dryrun/make-kit.sh <commit> [output.tar.gz]
#
# Uses `git archive <commit>` restricted to exactly the paths the Job
# needs, then re-roots `android/desktop/pc-ab-device` to `pc-ab-device`
# so that the layout inside the tar is:
#   scripts/operator/virtio-dryrun/                  (Job scripts)
#   android/desktop/manifest/pinned-manifest.xml     (pinned manifest)
#   pc-ab-device/                                    (patches + tools)
# Prints the tar's SHA-256 (the value the Job compares with KIT_SHA256).
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
commit=${1:?usage: make-kit.sh <commit> [output.tar.gz]}
out=${2:-"$repo/kit.tar.gz"}

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
git -C "$repo" archive "$commit" -- \
  scripts/operator/virtio-dryrun \
  android/desktop/manifest/pinned-manifest.xml \
  android/desktop/pc-ab-device | tar -x -C "$stage"
mv "$stage/android/desktop/pc-ab-device" "$stage/pc-ab-device"
rmdir "$stage/android/desktop/pc-ab-device" 2>/dev/null || true
rmdir "$stage/android/desktop" 2>/dev/null || true
tar -czf "$out" -C "$stage" .
shasum -a 256 "$out" | awk '{print $1}'
