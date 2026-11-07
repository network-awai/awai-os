# extraModule: absolute path of a NixOS module from the image builder. A real desktop image gets
# its update keys this way, so that they are not in this repository.
{ profile ? "vm", output ? "image", arch ? null, extraModule ? null }:
let
  nixpkgs = import ../../ci/nixpkgs.nix;
  # arch = null keeps the profile's own platform (aarch64-linux from common.nix).
  platform =
    if arch == null then [ ]
    else if builtins.elem arch [ "aarch64" "x86_64" ] then [ { nixpkgs.hostPlatform = "${arch}-linux"; } ]
    else throw "otehon: unknown arch ${arch}, expected aarch64 or x86_64";
  system = import "${nixpkgs}/nixos/lib/eval-config.nix" {
    system = null;
    modules = [ (./. + "/${profile}.nix") ] ++ platform
      ++ (if extraModule == null then [ ] else [ (/. + extraModule) ]);
  };
in
system.config.system.build.${if output == "system" then "toplevel" else "image"}
