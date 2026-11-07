{ lib, ... }:
{
  # Check image for media.nix: signs in as desktop-login does, then generates speech and
  # an image through the real shell. It is not a release.
  imports = [ ./desktop-login.nix ./gpu.nix ];

  system.image.id = lib.mkOverride 40 "awai-otehon-desktop-media";

  systemd.services.otehon-login-e2e.environment.OTEHON_MEDIA = "1";

  # The driver saves screenshots here for the host.
  fileSystems."/var/lib/otehon-results" = {
    device = "otehon-results";
    fsType = "virtiofs";
    options = [ "nofail" "x-systemd.device-timeout=5s" ];
  };

  # The driver waits for a long image job.
  systemd.services.otehon-login-e2e.serviceConfig.TimeoutStartSec = "infinity";
}
