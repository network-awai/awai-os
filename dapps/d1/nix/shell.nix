# Tools for the D1 core. Same Basilisp as Saifu/Sanka. The pinned nixpkgs has no nbb.
let pkgs = import (import ../../../ci/nixpkgs.nix) { };
    basilisp = pkgs.callPackage ../../saifu/nix/basilisp.nix { };
in pkgs.mkShell { packages = [ pkgs.babashka (pkgs.python3.withPackages (ps: [ basilisp ps.cryptography ])) ]; }
