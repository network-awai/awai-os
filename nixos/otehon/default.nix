# extraModule: absolute path of a NixOS module from the image builder. A real desktop image gets
# its update keys this way, so that they are not in this repository.
{ profile ? "vm", output ? "image", extraModule ? null }:
let
  nixpkgs = import ../../ci/nixpkgs.nix;
  system = import "${nixpkgs}/nixos/lib/eval-config.nix" {
    system = null;
    modules = [ (./. + "/${profile}.nix") ] ++ (if extraModule == null then [ ] else [ (/. + extraModule) ]);
  };
in
system.config.system.build.${if output == "system" then "toplevel" else "image"}
