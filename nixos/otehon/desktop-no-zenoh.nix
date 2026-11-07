{ lib, ... }:
{
  # Negative control for desktop-check-qemu.sh: the shell must report zenoh=0.
  imports = [ ./desktop-check.nix ];

  services.zenohd.enable = lib.mkForce false;
}
