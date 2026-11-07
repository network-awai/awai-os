{ lib, ... }:
{
  # Check image for Manimani: signs in as desktop-login does, then uses Manimani through the real
  # shell, with its real service and local model. It is not a release.
  imports = [ ./desktop-login.nix ];

  system.image.id = lib.mkOverride 40 "awai-otehon-desktop-manimani";

  systemd.services.otehon-login-e2e.environment.OTEHON_MANIMANI = "1";

  # The driver waits for a model that may be slow on the CPU.
  systemd.services.otehon-login-e2e.serviceConfig.TimeoutStartSec = "infinity";
}
