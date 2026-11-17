{ lib, pkgs, ... }:
{
  # Update version 3 in the check: boots, but a required unit fails, so it must not stay.
  imports = [ ./update-check.nix ];
  environment.etc."otehon-generation".text = "c";
  systemd.services.otehon-broken = {
    description = "A unit that fails, to exercise the automatic rollback";
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      Type = "oneshot";
      ExecStart = lib.getExe' pkgs.coreutils "false";
    };
  };
}
