{ lib, pkgs, ... }:
{
  # Check image for docs/otehon/protection-0.1.0.md: the sign-in check image, with the
  # driver in its protection mode and a short idle lock. It is not a release.
  # desktop-protect-check-qemu.sh boots it twice from one writable disk.
  imports = [ ./desktop-login.nix ];

  system.image.id = lib.mkOverride 40 "awai-otehon-desktop-protect";

  otehon.idleLockSeconds = 60;

  systemd.services.otehon-login-e2e.path = [ pkgs.util-linux ];
  systemd.services.otehon-login-e2e.environment = {
    OTEHON_PROTECT = "1";
    IDLE_LOCK_MS = "60000";
  };
}
