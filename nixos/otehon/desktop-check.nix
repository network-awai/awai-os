{ lib, ... }:
{
  # The desktop for check VMs, with the test update keys. It is not a release.
  imports = [ ./desktop.nix ./update-test-keys.nix ];

  system.image.id = lib.mkForce "awai-otehon-desktop-check";
}
