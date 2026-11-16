#!/usr/bin/env bash
# Run one existing Otehon VM gate on an isolated x86_64 Linux/KVM executor.
# This does not authorize a release, configure a scheduler, or qualify other gates.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$#" = 2 ] || { echo 'usage: ci-otehon-vm-local.sh {storage-reboot|drive|desktop-update} NEW_EVIDENCE_DIR' >&2; exit 2; }
case "$1" in
  storage-reboot) test_file=nixos/otehon/storage/reboot-check.nix ;;
  drive) test_file=nixos/otehon/drive/check.nix ;;
  desktop-update) test_file=nixos/tests/otehon-network-update.nix ;;
  *) echo 'unknown VM gate' >&2; exit 2 ;;
esac
: "${AWAI_NIXPKGS_ARCHIVE:?Set AWAI_NIXPKGS_ARCHIVE to an absolute local pinned archive}"
case "$AWAI_NIXPKGS_ARCHIVE" in /*) ;; *) echo 'archive path must be absolute' >&2; exit 2;; esac
[ -f "$AWAI_NIXPKGS_ARCHIVE" ] || { echo 'archive not found' >&2; exit 2; }
[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || { echo 'requires x86_64 Linux' >&2; exit 2; }
[ -r /dev/kvm ] && [ -w /dev/kvm ] || { echo 'requires accessible /dev/kvm' >&2; exit 2; }
command -v nix-build >/dev/null || { echo 'missing nix-build' >&2; exit 2; }
[ -z "$(git status --porcelain --untracked-files=all -- . ':(exclude).agent-output/**')" ] || { echo 'refuse dirty source checkout' >&2; exit 2; }
[ ! -e "$2" ] || { echo 'refuse existing evidence path' >&2; exit 2; }
mkdir -m 700 "$2"
evidence=$(cd "$2" && pwd -P)
printf '%s\n' "$(git rev-parse HEAD)" > "$evidence/source-revision.txt"
printf '%s\n' "$1" > "$evidence/gate.txt"
nix-build --version > "$evidence/nix-version.txt"
# Network isolation and pre-seeded Nix dependencies remain executor responsibilities.
# Preserve the failure code even when tee succeeds; absence of PASS is not success.
if nix-build "$test_file" --no-out-link --show-trace 2>&1 | tee "$evidence/build.log"; then
  printf 'PASS\n' > "$evidence/result.txt"
else
  printf 'FAIL\n' > "$evidence/result.txt"
  exit 1
fi
