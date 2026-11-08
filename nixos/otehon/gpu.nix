{ lib, pkgs, ... }:
{
  # GPU compute in a VM under krunkit on macOS: Venus forwards Vulkan to MoltenVK on the host.
  # krunkit's console is virtio, so it comes last and becomes /dev/console.
  boot.kernelParams = lib.mkAfter [ "console=hvc0" ];
  boot.initrd.availableKernelModules = [ "virtio_console" "virtiofs" ];
  boot.kernelModules = [ "virtio_gpu" ];

  hardware.graphics = {
    enable = true;
    # The patch a macOS host needs for Venus (mesa-venus-macos/README.md).
    package = pkgs.mesa.overrideAttrs (old: {
      patches = (old.patches or [ ]) ++ [
        ./mesa-venus-macos/0001-virtio-vulkan-force-16k-alignment-for-allocations-HA.patch
      ];
    });
  };
}
