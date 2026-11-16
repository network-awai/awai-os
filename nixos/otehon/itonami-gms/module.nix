{ config, lib, pkgs, ... }:
let
  cfg = config.otehon.itonami-gms;
in {
  options.otehon.itonami-gms.enable = lib.mkEnableOption
    "Itonami GMS offline Store inspection core (no service adapters or installer)";
  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ (import ./package.nix { inherit pkgs; }) ];
    environment.etc."itonami-gms/catalog.edn".source = ./catalog.edn;
    # No daemon, listening socket, keys, Google packages or Waydroid side effects.
  };
}
