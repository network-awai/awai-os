{ lib, pkgs, ... }:
{
  # Check image for docs/otehon/daily-0.1.0.md: the sign-in check image, with the driver in its
  # daily mode. desktop-daily-check-qemu.sh boots it twice from one writable disk. It is not a release.
  imports = [ ./desktop-login.nix ];

  system.image.id = lib.mkOverride 40 "awai-otehon-desktop-daily";

  systemd.services.otehon-login-e2e.path = [ pkgs.util-linux pkgs.curl pkgs.procps pkgs.gnugrep ];
  systemd.services.otehon-login-e2e.environment.OTEHON_DAILY = "1";
}
