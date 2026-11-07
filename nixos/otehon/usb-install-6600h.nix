{ config, lib, pkgs, ... }:
let
  build = config.system.build;
  disk = (import "${pkgs.path}/nixos/lib/eval-config.nix" {
    system = null;
    modules = [ ./disk-6600h.nix ];
  }).config.system.build.image;
  grubConfig = pkgs.writeText "awai-usb-grub.cfg" ''
    set timeout=3
    search --no-floppy --label --set=awai AWAIUSB
    menuentry 'Install Awai Otehon' {
      linux ($awai)/kernel init=${build.toplevel}/init ${toString config.boot.kernelParams}
      initrd ($awai)/initrd
    }
  '';
  image = pkgs.runCommand "awai-otehon-usb-installer" {
    nativeBuildInputs = [ pkgs.grub2_efi ];
  } ''
    mkdir -p $out/EFI/BOOT
    grub-mkstandalone -O x86_64-efi -o $out/EFI/BOOT/BOOTX64.EFI \
      --modules="part_gpt part_msdos fat search search_label linux normal" \
      "boot/grub/grub.cfg=${grubConfig}"
    ln -s ${build.kernel}/${config.system.boot.loader.kernelFile} $out/kernel
    ln -s ${build.netbootRamdisk}/initrd $out/initrd
    ln -s ${disk}/*.raw.zst $out/image.raw.zst
  '';
in
{
  # The existing installer verifies the compressed image and raw readback, requires a
  # unique serial and ERASE, and refuses mounted disks. Keep its USB source mounted
  # read-only throughout, so it cannot be selected as the target.
  imports = [ ./netboot-install-6600h.nix ];
  fileSystems."/run/otehon-usb" = {
    device = "/dev/disk/by-label/AWAIUSB";
    fsType = "vfat";
    noCheck = true;
    options = [ "ro" "nodev" "nosuid" "noexec" ];
  };
  systemd.services."otehon-install@" = {
    unitConfig.RequiresMountsFor = [ "/run/otehon-usb" ];
    environment.IMAGE_URL = lib.mkForce "file:///run/otehon-usb/image.raw.zst";
  };
  system.build.image = lib.mkOverride 40 image;
}
