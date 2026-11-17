#!/usr/bin/env bash
# JUN-1321: same steps as .github/workflows/otehon-yotei.yml, runnable by hand so the
# check does not depend on GitHub Actions. Needs Nix (nix-shell, nix-build, nix-store),
# xz, tar, sha256sum; the native package is built for x86_64-linux, so run it on
# a Linux Nix host. Evidence goes to ./delivery and ./yotei-nix.log.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
for c in nix-shell nix-build nix-store xz tar; do
  command -v "$c" >/dev/null || { echo "missing required command: $c (not executed)" >&2; exit 3; }
done
echo "== Build shared Web client and verify refusal cases"
nix-shell --expr 'let p = import (import ./ci/nixpkgs.nix) {}; in p.mkShell { packages = [ p.nodejs ]; }' --run 'node apps/yotei/scripts/build.mjs && node --test packages/awai-shell/test/*.test.mjs apps/yotei/test/*.test.mjs'
echo "== Build locked native Nix package"
nix-build --expr 'let p = import (import ./ci/nixpkgs.nix) {}; in p.callPackage ./apps/yotei/package.nix {}' --out-link result-yotei --option cores 2 --option max-jobs 1 2>&1 | tee yotei-nix.log
echo "== Export development closure and static Web artifact"
mkdir -p delivery
nix-store --query --requisites result-yotei > delivery/closure-paths.txt
nix-store --export $(cat delivery/closure-paths.txt) | xz -T2 > delivery/yotei-x86_64-linux.nar.xz
tar -C apps/yotei/dist -czf delivery/yotei-web.tar.gz .
sha256sum delivery/*.xz delivery/*.gz > delivery/SHA256SUMS
readlink -f result-yotei > delivery/store-path.txt
git rev-parse HEAD > delivery/source-revision.txt
echo "otehon-yotei check passed"
