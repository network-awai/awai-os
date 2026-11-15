#!/bin/sh
# Install a versioned Otehon desktop image for the macOS app.
#
# usage: install-image.sh <image.qcow2> <version>
# Needs <image.qcow2>.sha256 beside the image (written by macos-build.sh).
# Verifies sha256, then installs to ~/Library/Application Support/Otehon/.
set -eu
umask 077
image=${1:-}; version=${2:-}
[ -n "$image" ] && [ -f "$image" ] && [ -n "$version" ] || \
  { echo "usage: install-image.sh <image.qcow2> <version>" >&2; exit 64; }
[ -f "$image.sha256" ] || { echo "no sha256 record: $image.sha256" >&2; exit 1; }
case "$version" in ''|.|..|*[!A-Za-z0-9._-]*) echo "invalid version" >&2; exit 64;; esac
# Admit only the adjacent image record, never a path named by its contents.
record=$(cat "$image.sha256")
expected=${record%% *}
case "$expected" in *[!a-fA-F0-9]*) echo "invalid digest" >&2; exit 1;; esac
[ "${#expected}" = 64 ] || { echo "invalid digest" >&2; exit 1; }
[ "$record" = "$expected  $(basename "$image")" ] || \
  { echo "digest must name the adjacent image basename" >&2; exit 1; }
dest="$HOME/Library/Application Support/Otehon"
mkdir -p "$dest"
target="$dest/otehon-desktop-$version.qcow2"
[ ! -e "$target" ] && [ ! -L "$target" ] && [ ! -e "$target.sha256" ] && [ ! -L "$target.sha256" ] || \
  { echo "existing VM state preserved: $target" >&2; exit 1; }
stage=$(mktemp -d "$dest/.install-XXXXXXXX")
trap 'rm -f "$stage/image" "$stage/record"; rmdir "$stage"' EXIT HUP INT TERM
cp "$image" "$stage/image"
actual=$(shasum -a 256 "$stage/image"); actual=${actual%% *}
[ "$actual" = "$expected" ] || { echo "image digest mismatch" >&2; exit 1; }
printf '%s  %s\n' "$actual" "$(basename "$target")" > "$stage/record"
# A hard link fails atomically if another installer or an existing VM owns the
# destination. Never truncate a writable guest disk, including on repeat install.
ln "$stage/image" "$target"
ln "$stage/record" "$target.sha256"
echo "installed $target"
