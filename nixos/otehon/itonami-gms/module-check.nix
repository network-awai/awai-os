{ pkgs ? import (import ../../../ci/nixpkgs.nix) { } }:
let
  eval = enabled: import "${pkgs.path}/nixos/lib/eval-config.nix" {
    system = pkgs.stdenv.hostPlatform.system;
    modules = [ ./module.nix { otehon.itonami-gms.enable = enabled; system.stateVersion = "26.05"; } ];
  };
  off = (eval false).config;
  on = (eval true).config;
  packaged = config: builtins.any (p: pkgs.lib.getName p == "itonami-gms") config.environment.systemPackages;
in
assert !(packaged off);
assert !(off.environment.etc ? "itonami-gms/catalog.edn");
assert packaged on;
assert on.environment.etc."itonami-gms/catalog.edn".source == ./catalog.edn;
assert !(on.systemd.services ? itonami-gms);
pkgs.runCommand "itonami-gms-module-check" { } ''touch "$out"''
