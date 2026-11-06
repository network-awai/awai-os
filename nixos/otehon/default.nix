let
  nixpkgs = import ../../ci/nixpkgs.nix;
  system = import "${nixpkgs}/nixos/lib/eval-config.nix" {
    system = null;
    modules = [ ./vm.nix ];
  };
in
system.config.system.build.image
