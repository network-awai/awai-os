#!/usr/bin/env bash
# AWAI-4089 (G2): build the Job kit tarball from a specific commit.
#
#   scripts/operator/virtio-dryrun/make-kit.sh <commit> [output.tar.gz]
#
# Uses `git archive <commit>` restricted to exactly what the Job needs,
# then re-roots `android/desktop/pc-ab-device` to `pc-ab-device` so the
# layout inside the tar is:
#   scripts/operator/virtio-dryrun/                  (Job scripts + docs)
#   android/desktop/manifest/pinned-manifest.xml     (pinned manifest)
#   pc-ab-device/patches/                            (ALL repo patches)
#   pc-ab-device/apply.sh                            (Job apply tools)
#   pc-ab-device/apply-shipping-debug-lockdown.sh
#   pc-ab-device/pc-firmware.py
#   pc-ab-device/updater-feed.py
#   pc-ab-device/make-tf-disk.sh
# Bundle is limited to Job needs: evidence/installer subdirectories
# and non-Job sources do not enter the kit; patch-file count is taken at
# run time from pc-ab-device/patches/*.patch (no frozen head). The
# five tools stay the repo's own apply paths; #510/#511 update them
# and add patches, so no new tool list is needed when they land.
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
  android/desktop/pc-ab-device/patches \
  android/desktop/pc-ab-device/apply.sh \
  android/desktop/pc-ab-device/apply-shipping-debug-lockdown.sh \
  android/desktop/pc-ab-device/pc-firmware.py \
  android/desktop/pc-ab-device/updater-feed.py \
  android/desktop/pc-ab-device/make-tf-disk.sh | tar -x -C "$stage"
mv "$stage/android/desktop/pc-ab-device" "$stage/pc-ab-device"
rmdir "$stage/android/desktop" 2>/dev/null || true
# Plain `tar -x` under umask 077 drops the executable bits git archive
# carries; the Job runs these tools from $KIT/pc-ab-device, so restore.
chmod +x "$stage/pc-ab-device/apply.sh" \
  "$stage/pc-ab-device/apply-shipping-debug-lockdown.sh" \
  "$stage/pc-ab-device/pc-firmware.py" \
  "$stage/pc-ab-device/updater-feed.py" \
  "$stage/pc-ab-device/make-tf-disk.sh" \
  "$stage/scripts/operator/virtio-dryrun/build-inside.sh" \
  "$stage/scripts/operator/virtio-dryrun/make-kit.sh" \
  "$stage/scripts/operator/virtio-dryrun/virtio-job.sh"
tar -czf "$out" -C "$stage" .
shasum -a 256 "$out" | awk '{print $1}'
