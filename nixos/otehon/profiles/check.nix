{ pkgs ? import (import ../../../ci/nixpkgs.nix) { } }:
pkgs.runCommand "otehon-profile-catalog-check" {
  nativeBuildInputs = [ pkgs.babashka ];
} ''
  mkdir -p "$out" "$PWD/test-tmp"
  TEST_TMPDIR="$PWD/test-tmp" bb -cp ${./src}:${./test} ${./test/profile_catalog/core_test.clj} > "$out/tests.txt"
''
