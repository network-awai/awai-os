{ lib, ... }:
{
  # Negative control for desktop-check-qemu.sh: with no Nix database the updater cannot register
  # a new generation, so the report must say updater=0.
  imports = [ ./desktop-check.nix ];

  systemd.services.otehon-nix-db.enable = lib.mkForce false;
}
