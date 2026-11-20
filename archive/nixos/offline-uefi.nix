{ ... }: {
  imports = [ ./offline-base.nix ];
  fileSystems."/boot" = { device = "/dev/murakumo-boot"; fsType = "vfat"; options = [ "umask=0077" ]; };
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = false;
}
