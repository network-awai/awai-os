{ config, lib, modulesPath, pkgs, ... }:
let
  disk = (import "${pkgs.path}/nixos/lib/eval-config.nix" {
    system = null;
    modules = [ ./disk-6600h.nix ];
  }).config.system.build.image;
  digests = pkgs.runCommand "otehon-usb-payload-digests" { nativeBuildInputs = [ pkgs.zstd ]; } ''
    mkdir "$out"
    file=$(echo ${disk}/*.raw.zst)
    sha256sum "$file" | cut -d' ' -f1 > "$out/image"
    zstd -dc "$file" | sha256sum | cut -d' ' -f1 > "$out/raw"
    zstd -dc "$file" | wc -c > "$out/bytes"
  '';
in {
  # Offline UEFI/USB transport for the same reviewed, serial-confirmed installer.
  # The desktop is in the payload, not an additional live desktop on this medium.
  imports = [ ./common.nix ./hardware-6600h.nix "${modulesPath}/installer/cd-dvd/iso-image.nix" ];
  fileSystems."/" = lib.mkForce config.lib.isoFileSystems."/";
  networking.hostName = lib.mkForce "otehon-usb-installer";
  system.image.id = "awai-otehon-usb-installer";
  system.image.version = "0.7.0";
  image.baseName = lib.mkForce "awai-otehon-0.7.0-usb-x86_64";
  isoImage = {
    volumeID = "AWAI_OTEHON";
    makeEfiBootable = true;
    makeUsbBootable = true;
    makeBiosBootable = true;
    squashfsCompression = "zstd -Xcompression-level 6";
    contents = [{ source = "${disk}/awai-otehon-6600h.raw.zst"; target = "/otehon/image.raw.zst"; }];
  };
  users.users.root.hashedPassword = "!";
  services.openssh.enable = false;
  systemd.services."getty@tty1".enable = false;
  systemd.services."autovt@tty1".enable = false;
  systemd.services."serial-getty@ttyS0".enable = false;
  systemd.services."otehon-install@" = {
    description = "Offline Awai Otehon installer on %I";
    after = [ "local-fs.target" "systemd-udev-settle.service" ];
    path = with pkgs; [ bash config.systemd.package coreutils curl findutils gawk gnugrep gptfdisk jq util-linux zstd ];
    environment = { IMAGE_URL = "file:///iso/otehon/image.raw.zst"; DIGESTS = "${digests}"; };
    serviceConfig = {
      ExecStart = "${pkgs.bash}/bin/bash ${./install-disk.sh}";
      StandardInput = "tty-force"; StandardOutput = "tty"; StandardError = "tty";
      TTYPath = "/dev/%I"; TTYReset = true; Restart = "always"; RestartSec = 2;
    };
  };
  systemd.targets.multi-user.wants = [ "otehon-install@tty1.service" "otehon-install@ttyS0.service" ];
  system.build.image = lib.mkForce config.system.build.isoImage;
  system.build.otehonUsbDigests = digests;
}
