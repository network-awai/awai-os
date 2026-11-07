# Tools for the Sanka core. It uses the same Basilisp as Saifu. The pinned nixpkgs has no nbb.
let pkgs = import (import ../../../ci/nixpkgs.nix) { };
    basilisp = pkgs.callPackage ../../saifu/nix/basilisp.nix { };
in pkgs.mkShell { packages = [ pkgs.babashka (pkgs.python3.withPackages (ps: [ basilisp ps.cryptography ])) ]; }
