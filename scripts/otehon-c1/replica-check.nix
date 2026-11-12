{ pkgs ? import (import ../../ci/nixpkgs.nix) { } }:
let
  storage = import ../../nixos/otehon/storage/default.nix { inherit pkgs; };
  classpath = "${../../nixos/otehon/storage/src}:${../../nixos/otehon/storage/vendor/apex/src}:${../../nixos/otehon/storage/vendor/apex-car/src}:${../../nixos/otehon/shell/src}";
in pkgs.runCommand "otehon-public-replica-fixture-check" {
  nativeBuildInputs = [ pkgs.babashka storage ];
} ''
  mkdir -p "$out"
  bb --classpath ${classpath} ${./.}/replica_fixture_test.clj > "$out/tests.txt"
  bb --classpath ${classpath} ${./.}/reliability_test.clj >> "$out/tests.txt"
''
