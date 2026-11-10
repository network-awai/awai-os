{ pkgs ? import (import ../../../ci/nixpkgs.nix) { } }:
let
  nixpkgs = import ../../../ci/nixpkgs.nix;
  system = enable: (import "${nixpkgs}/nixos/lib/eval-config.nix" {
    system = pkgs.stdenv.hostPlatform.system;
    modules = [
      ../storage.nix
      { otehon.storage.enable = enable; system.stateVersion = "26.05"; }
    ];
  }).config;
  enabled = system true;
  disabled = system false;
  hasCli = config: pkgs.lib.any (p: p.name == "otehon-storage") config.environment.systemPackages;
in
assert hasCli enabled;
assert !(hasCli disabled);
assert !(enabled.systemd.services ? otehon-storage);
pkgs.writeText "otehon-storage-module-check.json" (builtins.toJSON {
  enabledHasCli = hasCli enabled;
  disabledHasCli = hasCli disabled;
  startsDaemon = false;
})
