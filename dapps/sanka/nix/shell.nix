# Tools for the Sanka core. It uses the same Basilisp as Saifu.
let pkgs = import (import ../../../ci/nixpkgs.nix) { };
    basilisp = pkgs.callPackage ../../saifu/nix/basilisp.nix { };
in pkgs.mkShell { packages = [ pkgs.nbb pkgs.babashka (pkgs.python3.withPackages (ps: [ basilisp ps.cryptography ])) ]; }
