{ pkgs ? import (import ../../../ci/nixpkgs.nix) { system = "aarch64-linux"; }, bundle }:
let
  evaluate = enabled: (import "${pkgs.path}/nixos/lib/eval-config.nix" {
    system = pkgs.stdenv.hostPlatform.system;
    modules = [ ./module.nix { services.awai-itonami-store = { enable = enabled; inherit bundle; }; system.stateVersion = "26.05"; } ];
  }).config;
  off = evaluate false;
  on = evaluate true;
  static = on.services.nginx.virtualHosts.awai-itonami-store.root;
in
assert !(off.services.nginx.virtualHosts ? awai-itonami-store);
assert !(builtins.any (p: pkgs.lib.getName p == "awai-itonami-store") off.environment.systemPackages);
assert builtins.all (x: x.addr == "127.0.0.1" && x.port == 8791 && !x.ssl) on.services.nginx.virtualHosts.awai-itonami-store.listen;
pkgs.runCommand "awai-itonami-store-module-check" { } ''
  test -f ${static}/index.html
  test -f ${static}/bundle-manifest.json
  test ! -e ${static}/packages
  touch "$out"
''
