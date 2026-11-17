{ modulesPath, lib, pkgs, ... }: {
  # A separate, non-destructive live workspace candidate. It does not replace
  # the legacy guided installer or silently install/format a target disk.
  imports = [ "${modulesPath}/installer/cd-dvd/installation-cd-minimal.nix" ./murakumo-nixos.nix ./native-media.nix ];
  services.murakumoNative.liveSession = true;
  networking.wireless.enable = lib.mkForce false;
  networking.networkmanager.enable = true;
  image.baseName = lib.mkForce "murakumo-nixos-0.1.1-x86_64-linux";
  isoImage.volumeID = "MURAKUMO_NIXOS";
  isoImage.squashfsCompression = "zstd -Xcompression-level 6";
  boot.kernelParams = [ "console=tty0" "console=ttyS0,115200n8" ];
  environment.systemPackages = [ pkgs.pciutils pkgs.vulkan-tools ];
  environment.etc."murakumo/native-source-pins.json".source = ./native-sources.json;
  environment.etc."murakumo/preview-boundary".text = ''
    Murakumo NixOS 0.1.1 local preview
    Static Itonami apps and a native unsigned host observer.
    No network admission, Cell conductor, distributed app storage or model
    installation is activated. This image does not format or install disks.
    Installed-host network update tools, source and guide are included under
    /etc/murakumo/native-profile and /etc/murakumo/network-update-guide.md.
    Network updates are disabled on this temporary live OS. Provisioning an
    installed target and its SSH trust requires a separate reviewed action.
    Physical GPU/firmware/power-loss qualification remains separate.
  '';
}
