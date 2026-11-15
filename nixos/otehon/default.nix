{ profile ? "vm", output ? "image", arch ? null, diagnosticPublicKey ? "" }:
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
      ++ (if builtins.elem profile [ "netboot-diagnostic-6600h" "netboot-nbd-install-6600h" ] then [ { otehon.diagnosticPublicKey = diagnosticPublicKey; } ] else [ ]);
  };
in
system.config.system.build.${if output == "system" then "toplevel" else "image"}
