#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
output=${1:-"$root/.agent-output/Awai OS Preview.app"}
test ! -e "$output" || { echo "Output exists; preserve or choose another worktree." >&2; exit 1; }
mkdir -p "$output/Contents/MacOS"
cp "$root/apps/macos-otehon-preview/Info.plist" "$output/Contents/Info.plist"
xcrun swiftc -O -parse-as-library -target arm64-apple-macos13.0 \
  "$root/apps/macos-otehon-preview/main.swift" -o "$output/Contents/MacOS/AwaiOSPreview"
codesign --force --sign - --entitlements "$root/apps/macos-otehon-preview/entitlements.plist" "$output"
codesign --verify --strict --verbose=1 "$output"
echo "$output"
