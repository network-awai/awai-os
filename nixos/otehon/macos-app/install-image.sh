#!/bin/sh
# Install a versioned Otehon desktop image for the macOS app.
#
# usage: install-image.sh <image.qcow2> <version>
# Needs <image.qcow2>.sha256 beside the image (written by macos-build.sh).
# Verifies sha256, then installs to ~/Library/Application Support/Otehon/.
set -eu
image=${1:-}; version=${2:-}
[ -n "$image" ] && [ -f "$image" ] && [ -n "$version" ] || \
  { echo "usage: install-image.sh <image.qcow2> <version>" >&2; exit 64; }
[ -f "$image.sha256" ] || { echo "no sha256 record: $image.sha256" >&2; exit 1; }
(cd "$(dirname "$image")" && shasum -a 256 -c "$(basename "$image").sha256") || exit 1
dest="$HOME/Library/Application Support/Otehon"
mkdir -p "$dest"
cp "$image" "$dest/otehon-desktop-$version.qcow2"
cp "$image.sha256" "$dest/otehon-desktop-$version.qcow2.sha256"
echo "installed $dest/otehon-desktop-$version.qcow2"
