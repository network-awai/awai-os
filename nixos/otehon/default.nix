{ profile ? "vm", output ? "image" }:
let
  nixpkgs = import ../../ci/nixpkgs.nix;
  system = import "${nixpkgs}/nixos/lib/eval-config.nix" {
    system = null;
    modules = [ (./. + "/${profile}.nix") ];
  };
in
system.config.system.build.${if output == "system" then "toplevel" else "image"}
