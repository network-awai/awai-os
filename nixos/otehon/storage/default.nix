{ pkgs ? import (import ../../../ci/nixpkgs.nix) { } }:
let
  pin = builtins.fromJSON (builtins.readFile ./vendor/source.json);
  wal = ./vendor/apex/src/awai/fs/wal.cljc;
  carPin = builtins.fromJSON (builtins.readFile ./vendor/car-source.json);
in
# Exact upstream dependency, not a separately implemented recovery algorithm.
# Vendoring this one module keeps private-repository credentials out of Nix.
assert builtins.hashFile "sha256" wal == pin.sha256;
assert builtins.hashFile "sha256" ./vendor/apex-car/src/awai/fs/car.cljc == carPin.sha256;
pkgs.writeShellScriptBin "otehon-storage" ''
  exec ${pkgs.babashka}/bin/bb --classpath ${./src}:${./vendor/apex/src}:${./vendor/apex-car/src} -m otehon.cli "$@"
''
