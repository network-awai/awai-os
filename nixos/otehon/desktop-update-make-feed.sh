#!/bin/sh
# Build the feeds for desktop-update-check-qemu.sh inside the Nix container. Run from the repository
# root. It writes only under the given directory and uses the test keys in fixtures/update.
# usage: desktop-update-make-feed.sh <dir>
#
# The two systems share almost all paths, so they share one cache. NARs that the check image
# already holds are removed to save disk: Nix reads their narinfo, and fetches only missing paths.
set -eu
out=$1
fix=nixos/otehon/fixtures/update
ms=$(nix-build -E 'with import (import ./ci/nixpkgs.nix) {}; minisign' --no-out-link)/bin/minisign
export NIX_CONFIG="$NIX_CONFIG
experimental-features = nix-command"
base=$(nix-build nixos/otehon/default.nix --argstr profile desktop-update-check --argstr output system --no-out-link)
good=$(nix-build nixos/otehon/default.nix --argstr profile desktop-update-check-good --argstr output system --no-out-link)
bad=$(nix-build nixos/otehon/default.nix --argstr profile desktop-update-check-bad --argstr output system --no-out-link)
rm -rf "$out"
mkdir -p "$out/good" "$out/bad"
cache="file://$PWD/$out/cache?secret-key=$PWD/$fix/test-cache.key&compression=none"
nix copy --to "$cache" "$good" "$bad"
ln -s ../cache "$out/good/cache"
ln -s ../cache "$out/bad/cache"
printf '{"version":2,"system":"%s"}\n' "$good" > "$out/good/manifest.json"
printf '{"version":3,"system":"%s"}\n' "$bad" > "$out/bad/manifest.json"
"$ms" -S -q -W -s $fix/test-manifest.key -m "$out/good/manifest.json" -x "$out/good/manifest.json.minisig"
"$ms" -S -q -W -s $fix/test-manifest.key -m "$out/bad/manifest.json" -x "$out/bad/manifest.json.minisig"

nix-store -qR "$base" | sed -E 's|/nix/store/([0-9a-z]{32})-.*|\1|' | while read -r hash; do
  info="$out/cache/$hash.narinfo"
  [ -e "$info" ] || continue
  rm -f "$out/cache/$(sed -n 's/^URL: //p' "$info")"
done
echo "paths in the cache: $(ls "$out/cache" | grep -c narinfo), NARs kept: $(ls "$out/cache/nar" | wc -l)"
du -sh "$out"
