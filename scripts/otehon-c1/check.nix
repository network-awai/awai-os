{ pkgs ? import (import ../../ci/nixpkgs.nix) { } }:
pkgs.runCommand "otehon-c1-preflight-check" {
  nativeBuildInputs = [ pkgs.babashka pkgs.bash pkgs.coreutils ];
} ''
  mkdir -p scripts "$out"
  cp -R ${./.} scripts/otehon-c1
  bb scripts/otehon-c1/preflight_test.clj > "$out/tests.txt"
''
