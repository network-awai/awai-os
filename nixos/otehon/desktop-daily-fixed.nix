{ lib, ... }:
{
  # Negative control for docs/otehon/daily-0.1.0.md: the daily check image with the time zone fixed
  # in the configuration. NixOS then points timedated at /etc/static/localtime, in the read-only store,
  # so setting a zone fails and the Settei step must fail.
  imports = [ ./desktop-daily.nix ];

  system.image.id = lib.mkOverride 30 "awai-otehon-desktop-daily-fixed";
  time.timeZone = lib.mkForce "UTC";
}
