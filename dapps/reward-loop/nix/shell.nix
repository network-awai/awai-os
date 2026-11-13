# Tools for the reward-loop core. Same Basilisp as Saifu/Sanka/D1. The pinned nixpkgs has no nbb.
let pkgs = import (import ../../../ci/nixpkgs.nix) { };
    basilisp = pkgs.callPackage ../../saifu/nix/basilisp.nix { };
in pkgs.mkShell { packages = [ pkgs.babashka (pkgs.python3.withPackages (ps: [ basilisp ps.cryptography ])) ]; }
