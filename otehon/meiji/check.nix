{ pkgs ? import (import ../../ci/nixpkgs.nix) { } }:
pkgs.runCommand "otehon-meiji-controller-check" {
  nativeBuildInputs = [ pkgs.babashka pkgs.coreutils ];
} ''
  cp -R ${./src} src
  cp -R ${./test} test
  cp ${./bb.edn} bb.edn
  # Otehon only: CPU/protocol/owned child fixtures, no hypervisor or model.
  # Mac system-crypto cases run locally; this Linux check does not qualify GPU.
  bb test > "$out"
  bb -cp src test/meiji/migration_test.cljc >> "$out"
''
