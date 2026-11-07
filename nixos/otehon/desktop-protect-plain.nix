{ lib, ... }:
{
  # Negative control for the disk search in desktop-protect-check-qemu.sh. It is the same
  # check image, except that the user's directory is on the plain root partition. The driver
  # must refuse it (profile-not-on-volume), and the disk search must then find the canary,
  # which proves that the canary reaches the disk. Never a release.
  imports = [ ./desktop-protect.nix ];

  system.image.id = lib.mkOverride 30 "awai-otehon-desktop-protect-plain";

  otehon.userState = "/var/lib/otehon-plain-user/otehon";
}
