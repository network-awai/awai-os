{ config, lib, modulesPath, pkgs, ... }:
let
  rootLabel = "otehon-root";
  efiArch = config.nixpkgs.hostPlatform.efiArch;
  ukiFile = config.system.boot.loader.ukiFile;
in
{
  # Shared by the Awai Otehon images (ADR 0026): the pinned aarch64 system, the
  # disk layout and a boot report on the serial console.
  imports = [
    "${modulesPath}/image/repart.nix"
    "${modulesPath}/profiles/qemu-guest.nix"
  ];

  nixpkgs.hostPlatform = "aarch64-linux";
  system.stateVersion = "26.05";
  networking.hostName = "awai-otehon";

  boot.loader.grub.enable = false;
  boot.kernelParams = [ "console=ttyAMA0,115200n8" ];
  fileSystems."/" = {
    device = "/dev/disk/by-partlabel/${rootLabel}";
    fsType = "ext4";
  };

  systemd.services.otehon-boot-report = {
    description = "Report the Awai Otehon boot state on the console";
    wantedBy = [ "multi-user.target" ];
    after = [ "multi-user.target" ];
    serviceConfig = {
      Type = "oneshot";
      StandardOutput = "tty";
      TTYPath = "/dev/console";
    };
    path = [ pkgs.coreutils config.systemd.package ];
    script = lib.mkDefault ''
      failed=$(systemctl list-units --state=failed --no-legend | wc -l)
      echo "OTEHON_BOOT_REPORT id=${config.system.image.id} version=${config.system.image.version} nixos=${config.system.nixos.version} failed=$failed"
    '';
  };

  image.repart = {
    name = config.system.image.id;
    # The QEMU firmware does not boot the default repart sector size of 4096.
    sectorSize = 512;
    partitions = {
      esp = {
        contents = {
          "/EFI/BOOT/BOOT${lib.toUpper efiArch}.EFI".source =
            "${pkgs.systemd}/lib/systemd/boot/efi/systemd-boot${efiArch}.efi";
          "/EFI/Linux/${ukiFile}".source = "${config.system.build.uki}/${ukiFile}";
        };
        repartConfig = {
          Type = "esp";
          Format = "vfat";
          SizeMinBytes = lib.mkDefault "128M";
        };
      };
      root = {
        storePaths = [ config.system.build.toplevel ];
        repartConfig = {
          Type = "root";
          Format = "ext4";
          Label = rootLabel;
          Minimize = "off";
          SizeMinBytes = lib.mkDefault "3G";
          SizeMaxBytes = lib.mkDefault "3G";
        };
      };
    };
  };
}
