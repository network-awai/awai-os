#!/bin/sh
# Build the update feeds for update-check-qemu.sh inside the Nix container. Run from the repository
# root. It writes only under the given directory and uses the test keys in fixtures/update.
set -eu
out=$1
fix=nixos/otehon/fixtures/update
ms=$(nix-build -E 'with import (import ./ci/nixpkgs.nix) {}; minisign' --no-out-link)/bin/minisign
export NIX_CONFIG="$NIX_CONFIG
experimental-features = nix-command"
good=$(nix-build nixos/otehon/default.nix --argstr profile update-check-good --argstr output system --no-out-link)
bad=$(nix-build nixos/otehon/default.nix --argstr profile update-check-bad --argstr output system --no-out-link)
rm -rf "$out"
sign() { "$ms" -S -q -W -s "$2" -m "$1/manifest.json" -x "$1/manifest.json.minisig" ; }
manifest() { mkdir -p "$1"; printf '{"version":%s,"system":"%s"}\n' "$2" "$3" > "$1/manifest.json"; }

manifest "$out/good" 2 "$good"; sign "$out/good" $fix/test-manifest.key
nix copy --to "file://$PWD/$out/good/cache?secret-key=$PWD/$fix/test-cache.key&compression=none" "$good"
manifest "$out/bad" 3 "$bad"; sign "$out/bad" $fix/test-manifest.key
nix copy --to "file://$PWD/$out/bad/cache?secret-key=$PWD/$fix/test-cache.key&compression=none" "$bad"

manifest "$out/unsigned" 2 "$good"
manifest "$out/wrong-key" 2 "$good"; sign "$out/wrong-key" $fix/test-wrong.key
manifest "$out/tampered" 2 "$good"; sign "$out/tampered" $fix/test-manifest.key
printf '{"version":99,"system":"%s"}\n' "$good" > "$out/tampered/manifest.json"
manifest "$out/downgrade" 1 "$good"; sign "$out/downgrade" $fix/test-manifest.key
# A valid manifest whose closure was signed by another cache key.
manifest "$out/unsigned-closure" 2 "$good"; sign "$out/unsigned-closure" $fix/test-manifest.key
nix copy --to "file://$PWD/$out/unsigned-closure/cache?secret-key=$PWD/$fix/test-wrong-cache.key&compression=none" "$good"
du -sh "$out"
