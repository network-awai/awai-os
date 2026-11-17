{ nixpkgsPath ? import ../../ci/nixpkgs.nix }:
let
  system = import (nixpkgsPath + "/nixos") {
    system = "x86_64-linux";
    configuration = {
      imports = [ ./murakumo-nixos.nix ];
      services.murakumoNative = { desktop = false; networkUpdates = { enable = true; hostId = "build-check"; }; };
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
    };
  };
in system.config.system.build.murakumoNetworkUpdate
