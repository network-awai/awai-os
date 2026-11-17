{ config, lib, modulesPath, pkgs, ... }:
let
  build = config.system.build;
  server = "http://10.77.0.1:8080";
  cmdline = "init=${build.toplevel}/init ${toString config.boot.kernelParams}";
  disk = (import "${pkgs.path}/nixos/lib/eval-config.nix" {
    system = null;
    modules = [ ./disk-6600h.nix ];
  }).config.system.build.image;
  # Only digests, so the installer pins the image without carrying it.
  digests = pkgs.runCommand "awai-otehon-image-digests" { nativeBuildInputs = [ pkgs.zstd ]; } ''
    mkdir $out
    file=$(echo ${disk}/*.raw.zst)
    sha256sum "$file" | cut -d' ' -f1 > $out/image
    zstd -dc "$file" | sha256sum | cut -d' ' -f1 > $out/raw
    zstd -dc "$file" | wc -c > $out/bytes
  '';
  ipxe = pkgs.ipxe.override {
    embedScript = pkgs.writeText "otehon-install.ipxe" ''
      #!ipxe
      dhcp
      kernel ${server}/kernel initrd=initrd ${cmdline}
      initrd ${server}/initrd
      boot
    '';
  };
  image = pkgs.runCommand "awai-otehon-install" { } ''
    mkdir $out
    ln -s ${ipxe}/snp.efi $out/ipxe.efi
    ln -s ${build.kernel}/${config.system.boot.loader.kernelFile} $out/kernel
    ln -s ${build.netbootRamdisk}/initrd $out/initrd
    ln -s ${disk}/*.raw.zst $out/image.raw.zst
    cat ${digests}/image > $out/image.sha256
  '';
in
{
  # The installer in RAM, over UEFI PXE. It writes only after someone at this PC types a disk's
  # serial and then ERASE. Its only login is that prompt. It runs on the screen and on the serial
  # port, which is how the emulator check drives this same build.
  imports = [
    ./common.nix
    ./hardware-6600h.nix
    "${modulesPath}/installer/netboot/netboot.nix"
  ];

  system.image.id = "awai-otehon-install";
  system.image.version = "0.1.0";

  users.users.root.hashedPassword = "!";
  systemd.services."getty@tty1".enable = false;
  systemd.services."autovt@tty1".enable = false;
  systemd.services."serial-getty@ttyS0".enable = false;

  systemd.services."otehon-install@" = {
    description = "Awai Otehon installer on %I";
    after = [ "network-online.target" "systemd-udev-settle.service" ];
    path = with pkgs; [
      bash
      config.systemd.package
      coreutils
      curl
      findutils
      gawk
      gnugrep
      gptfdisk
      jq
      util-linux
      zstd
    ];
    environment = {
      IMAGE_URL = "${server}/image.raw.zst";
      DIGESTS = "${digests}";
    };
    serviceConfig = {
      ExecStart = "${pkgs.bash}/bin/bash ${./install-disk.sh}";
      StandardInput = "tty-force";
      StandardOutput = "tty";
      StandardError = "tty";
      TTYPath = "/dev/%I";
      TTYReset = true;
      Restart = "always";
      RestartSec = 2;
    };
  };
  systemd.targets.multi-user.wants = [ "otehon-install@tty1.service" "otehon-install@ttyS0.service" ];

  netboot.squashfsCompression = "zstd -Xcompression-level 6";

  system.build.image = lib.mkForce image;
}
