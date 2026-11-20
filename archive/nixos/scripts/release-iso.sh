#!/bin/sh
# Run the installer checks and build from reviewed local source. This script
# produces an identity record; independent fleet receipts and artifact
# replication are separate release gates.
set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 /absolute/path/to/pinned-nixpkgs /absolute/empty/evidence-directory" >&2
  exit 2
fi

case "$1:$2" in
  /*:/*) ;;
  *) echo 'Both paths must be absolute.' >&2; exit 2 ;;
esac

repo=$(CDPATH= cd "$(dirname "$0")/.." && pwd -P)
nixpkgs=$(CDPATH= cd "$1" && pwd -P)
evidence=$2
expected=$(cat "$repo/nixos/nixpkgs-revision.txt")

printf '%s\n' "$expected" | grep -Eq '^[0-9a-f]{40}$' || {
  echo 'Invalid pinned nixpkgs revision.' >&2; exit 2;
}
test "$(git -C "$repo" rev-parse --is-inside-work-tree)" = true || {
  echo 'Installer must be a Git checkout.' >&2; exit 2;
}
test -z "$(git -C "$repo" status --porcelain --untracked-files=all)" || {
  echo 'Installer checkout is not clean.' >&2; exit 2;
}
test -z "$(git -C "$nixpkgs" status --porcelain --untracked-files=all)" || {
  echo 'nixpkgs checkout is not clean.' >&2; exit 2;
}
actual=$(git -C "$nixpkgs" rev-parse HEAD)
test "$actual" = "$expected" || {
  echo "nixpkgs revision mismatch: expected $expected, got $actual" >&2; exit 2;
}
test ! -e "$evidence" || {
  echo "Evidence directory already exists: $evidence" >&2; exit 2;
}

cd "$repo"
node --test archive/nixos/test/device-claim.test.mjs archive/nixos/test/node-readiness.test.mjs
./scripts/build-iso.sh "$nixpkgs"

set -- result/iso/*.iso
test "$#" -eq 1 && test -f "$1" || {
  echo 'Expected exactly one built ISO.' >&2; exit 1;
}
iso=$1
mkdir -p "$evidence"
sha256sum "$iso" > "$evidence/iso.sha256"
wc -c < "$iso" | tr -d ' ' > "$evidence/iso-size.txt"
printf '%s\n' "$(git rev-parse HEAD)" > "$evidence/installer-source-revision.txt"
printf '%s\n' "$expected" > "$evidence/nixpkgs-revision.txt"
printf '%s\n' "$(cd "$(dirname "$iso")" && pwd -P)/$(basename "$iso")" > "$evidence/iso-path.txt"
echo "ISO built and identity recorded in $evidence"
