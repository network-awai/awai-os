# Tools for the Saifu prototype. Java runs only to compile ClojureScript, never in the OS.
let pkgs = import (import ../../../ci/nixpkgs.nix) { };
    basilisp = pkgs.callPackage ./basilisp.nix { };
in pkgs.mkShell { packages = [ pkgs.nodejs pkgs.jdk21_headless (pkgs.python3.withPackages (_: [ basilisp ])) ]; }
