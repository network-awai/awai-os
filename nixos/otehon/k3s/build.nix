{ node, addresses, interface, tokenFile, managementAddresses ? [ ]
, arch ? "aarch64", output ? "image" }:
assert builtins.elem arch [ "aarch64" "x86_64" ];
assert builtins.elem output [ "image" "system" ];
let
  nixpkgs = import ../../../ci/nixpkgs.nix;
  system = import "${nixpkgs}/nixos/lib/eval-config.nix" {
    system = null;
    modules = [
      (import ./desktop.nix { inherit node addresses interface tokenFile managementAddresses; })
      { nixpkgs.hostPlatform = "${arch}-linux"; }
    ];
  };
in system.config.system.build.${if output == "system" then "toplevel" else "image"}
