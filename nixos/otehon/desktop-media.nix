{ lib, ... }:
{
  # Check image for media.nix under krunkit: signs in as desktop-login does, then generates
  # speech and an image through the real shell on the GPU. krunkit has no display, so the shell
  # is in headless Chromium here. desktop-media-gui.nix checks the compositor path. It is not
  # a release.
  imports = [ ./desktop-login.nix ./gpu.nix ];

  system.image.id = lib.mkOverride 40 "awai-otehon-desktop-media";

  otehon.headless = true;
  otehon.modelShare = true;

  systemd.services.otehon-login-e2e.environment = {
    OTEHON_MEDIA = "1";
    OTEHON_MEDIA_IMAGE = "1";
  };

  # The driver saves generated files and screenshots here for the host.
  fileSystems."/var/lib/otehon-results" = {
    device = "otehon-results";
    fsType = "virtiofs";
    options = [ "nofail" "x-systemd.device-timeout=5s" ];
  };

  # The driver waits for a long image job.
  systemd.services.otehon-login-e2e.serviceConfig.TimeoutStartSec = "infinity";
}
