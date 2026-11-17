{ config, lib, pkgs, ... }:
{
  options.otehon.storage.enable = lib.mkEnableOption
    "the experimental local Otehon checkpoint/WAL storage CLI";

  # Opt-in tooling only. Enabling it never creates/migrates a store or starts
  # a daemon. Operational state belongs on the unlocked encrypted volume.
  config = lib.mkIf config.otehon.storage.enable {
    environment.systemPackages = [ (import ./storage/default.nix { inherit pkgs; }) ];
  };
}
