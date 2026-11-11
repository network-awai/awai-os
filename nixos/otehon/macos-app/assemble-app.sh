#!/bin/sh
# Assemble the Otehon Desktop macOS app bundle.
#
# usage: assemble-app.sh <dest-dir> <version> [--bundle-image <image.qcow2>]
#
# Writes <dest-dir>/Otehon Desktop.app (Info.plist + launcher). With
# --bundle-image the qcow2 is copied into Resources (large); without it
# the app boots the versioned image from ~/Library/Application Support/
# Otehon/ (see install-image.sh).
set -eu
dest=${1:-}; version=${2:-}
[ -n "$dest" ] && [ -n "$version" ] || \
  { echo "usage: assemble-app.sh <dest-dir> <version> [--bundle-image <image.qcow2>]" >&2; exit 64; }
here=$(cd "$(dirname "$0")" && pwd)
app="$dest/Otehon Desktop.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
sed "s/__VERSION__/$version/g" "$here/Info.plist.template" > "$app/Contents/Info.plist"
sed "s/__VERSION__/$version/g" "$here/launcher.sh" > "$app/Contents/MacOS/otehon-desktop"
chmod +x "$app/Contents/MacOS/otehon-desktop"
if [ "${3:-}" = "--bundle-image" ]; then
  [ -n "${4:-}" ] && [ -f "$4" ] || { echo "no image: $4" >&2; exit 64; }
  cp "$4" "$app/Contents/Resources/otehon-desktop.qcow2"
fi
echo "assembled $app"
