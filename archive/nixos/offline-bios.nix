{ pkgs, ... }: {
  imports = [ ./offline-base.nix ];
  boot.loader.grub.enable = true;
  # Generate the menu here; the ISO installs GRUB onto the approved disk.
  boot.loader.grub.device = "nodev";
  environment.systemPackages = [ pkgs.grub2 ];
}
