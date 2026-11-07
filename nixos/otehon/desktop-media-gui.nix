{ lib, ... }:
{
  # Check image for media.nix under QEMU: the compositor and Chromium with a display, no GPU
  # compute and no model share. Speech must work through the shell, and images must be refused
  # with image-model-missing. It is not a release.
  imports = [ ./desktop-login.nix ];

  system.image.id = lib.mkOverride 40 "awai-otehon-desktop-media-gui";

  systemd.services.otehon-login-e2e.environment = {
    OTEHON_MEDIA = "1";
    OTEHON_MEDIA_IMAGE = "0";
  };
}
