#!/bin/sh
# Real filesystem controls; no QEMU, live user profile or VM disk is accessed.
set -eu
repo=$(pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/otehon-image-test-XXXXXXXX")
trap 'rm -rf "$work"' EXIT
export HOME="$work/home"
mkdir -p "$HOME" "$work/source" "$work/moved"
printf 'known image bytes\n' > "$work/source/input.qcow2"
(cd "$work/source" && shasum -a 256 input.qcow2 > input.qcow2.sha256)
cp "$work/source/"* "$work/moved/"
install="$repo/nixos/otehon/macos-app/install-image.sh"
sh "$install" "$work/moved/input.qcow2" test
disk="$HOME/Library/Application Support/Otehon/otehon-desktop-test.qcow2"
cmp "$work/source/input.qcow2" "$disk"
(cd "$(dirname "$disk")" && shasum -a 256 -c "$(basename "$disk").sha256")
printf 'live VM user state\n' >> "$disk"
before=$(shasum -a 256 "$disk")
if sh "$install" "$work/moved/input.qcow2" test; then exit 1; fi
[ "$before" = "$(shasum -a 256 "$disk")" ]
# A copied receipt must never verify some other absolute path instead.
shasum -a 256 "$work/source/input.qcow2" > "$work/moved/input.qcow2.sha256"
if sh "$install" "$work/moved/input.qcow2" absolute; then exit 1; fi
test ! -e "$HOME/Library/Application Support/Otehon/otehon-desktop-absolute.qcow2"
(cd "$work/moved" && shasum -a 256 input.qcow2 > input.qcow2.sha256)
printf 'corrupt\n' >> "$work/moved/input.qcow2"
if sh "$install" "$work/moved/input.qcow2" corrupt; then exit 1; fi
test ! -e "$HOME/Library/Application Support/Otehon/otehon-desktop-corrupt.qcow2"
if sh "$install" "$work/moved/input.qcow2" ../escape; then exit 1; fi
echo 'MACOS-IMAGE-PRESERVATION-PASS'
