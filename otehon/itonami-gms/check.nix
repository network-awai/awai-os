{ pkgs ? import (import ../../ci/nixpkgs.nix) { } }:
pkgs.runCommand "itonami-gms-core-check" { nativeBuildInputs = [ pkgs.babashka ]; } ''
  cd ${./.}
  bb -cp src:test -m itonami.gms.test-runner
  touch "$out"
''
