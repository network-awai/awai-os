#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /absolute/path/to/pinned-nixpkgs-tree" >&2
  exit 2
fi
nixpkgs=$(cd "$1" && pwd -P)
test -f "$nixpkgs/nixos/default.nix" || { echo "Not a nixpkgs tree: $nixpkgs" >&2; exit 2; }
command -v nix-build >/dev/null 2>&1 || { echo 'nix-build is required.' >&2; exit 2; }
if [ -f "$nixpkgs/.git-revision" ]; then
  revision=$(cat "$nixpkgs/.git-revision")
elif [ -e "$nixpkgs/.git" ]; then
  test -z "$(git -C "$nixpkgs" status --porcelain)" || {
    echo 'nixpkgs checkout is dirty; review and commit it first.' >&2; exit 2;
  }
  revision=$(git -C "$nixpkgs" rev-parse HEAD)
elif [ "$(nix-hash --type sha256 --base32 "$nixpkgs")" = "11cw91q3r1nrlh3sc86n1jipgijy3njp3z9s3j0rwi6mi2adc6ki" ]; then
  revision=f5c082a40f7571c266e74e80ae2e68aadd8a9fc7
else
  echo 'nixpkgs must be a clean Git checkout, immutable channel or the CI content pin.' >&2
  exit 2
fi
printf '%s\n' "$revision" | grep -Eq '^[0-9a-f]{40}$' || {
  echo 'nixpkgs revision is not a full commit SHA.' >&2; exit 2;
}
echo "nixpkgs revision: $revision"
repo=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo"
node "$repo/scripts/check-setup-vm.mjs" "$nixpkgs"
nix-build "$nixpkgs/nixos" -A config.system.build.isoImage \
  -I "nixpkgs=$nixpkgs" -I "nixos-config=$repo/nixos/iso.nix"
