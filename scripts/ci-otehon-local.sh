#!/usr/bin/env bash
# Run the Otehon evaluation job locally with operator-supplied pinned inputs.
# This is not the separate native, Forest writer, VM, installer, or release gate.
# Network isolation and pre-seeding all dependencies are the operator's responsibility.
set -euo pipefail
cd "$(dirname "$0")/.."
repo=$(pwd -P)
: "${AWAI_NIXPKGS_ARCHIVE:?Set AWAI_NIXPKGS_ARCHIVE to an absolute local pinned archive}"
case "$AWAI_NIXPKGS_ARCHIVE" in /*) ;; *) echo 'archive path must be absolute' >&2; exit 2;; esac
[ -f "$AWAI_NIXPKGS_ARCHIVE" ] || { echo 'archive not found' >&2; exit 2; }
for cmd in nix-build nix-instantiate node npm python3; do
  command -v "$cmd" >/dev/null || { echo "missing required command: $cmd" >&2; exit 2; }
done
[ -z "$(git status --porcelain --untracked-files=all -- . ':(exclude).agent-output/**')" ] || {
  echo 'refuse dirty source checkout' >&2; exit 2;
}
export AWAI_NIXPKGS_ARCHIVE
printf 'Otehon local gate source: %s\n' "$(git rev-parse HEAD)"
printf 'This is not a VM, native, Forest writer, installer, or release qualification.\n'
printf 'Deprecated NixOS profile evaluation is archived under archive/nixos/otehon and not run here.\n'
(cd otehon/shell && npm ci --offline --no-audit --no-fund && npm test)
sh scripts/otehon-mobile/test-collect-p0.sh
node --test dapps/saifu/test/host-bridge.test.mjs
preflight=$(nix-build scripts/otehon-c1/check.nix --no-out-link)
cat "$preflight/tests.txt"
replica=$(nix-build scripts/otehon-c1/replica-check.nix --no-out-link)
cat "$replica/tests.txt"
storage=$(nix-build otehon/storage/check.nix --no-out-link)
cat "$storage/unit-tests.txt" "$storage/crash-tests.edn" "$storage/pack-crash-tests.edn"
echo 'Otehon local evaluation gate passed.'
