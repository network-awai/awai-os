#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo"
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/murakumo-config-test.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT
node "$repo/test/generate-install-config.mjs" "$repo" "$test_dir"
for mode in bios uefi; do
  config="$test_dir/$mode/configuration.nix"
  nix-instantiate --parse "$config" >/dev/null
  MURAKUMO_TEST_CONFIG="$config" nix-instantiate --eval --strict --expr 'let s = import <nixpkgs/nixos> { configuration = builtins.toPath (builtins.getEnv "MURAKUMO_TEST_CONFIG"); system = "x86_64-linux"; }; in s.config.system.build.toplevel.drvPath'
done
