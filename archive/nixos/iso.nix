{ modulesPath, pkgs, ... }:
let
  target = mode: (import (pkgs.path + "/nixos") {
    system = pkgs.stdenv.hostPlatform.system;
    configuration = ./. + "/offline-${mode}.nix";
  }).config.system.build.toplevel;
  uefi = target "uefi";
  bios = target "bios";
in
{
  imports = [ "${modulesPath}/installer/cd-dvd/installation-cd-minimal.nix" ./console-ui.nix ./remote-access.nix ];
  services.murakumoRemote.enable = true;
  # Keep boot diagnostics from overwriting the disk selection screen.
  boot.consoleLogLevel = 3;
  boot.kernelParams = [ "quiet" "systemd.show_status=false" "rd.systemd.show_status=false" ];
  environment.systemPackages = with pkgs; [ curl git pciutils vim nodejs_22 dialog networkmanager iproute2 parted dosfstools e2fsprogs grub2 ];
  environment.etc."murakumo/installation-media".text = "Murakumo installer\n";
  environment.etc."murakumo/install-disk.mjs".source = archive/nixos/scripts/install-disk.mjs;
  environment.etc."murakumo/usb-update.mjs".source = ./usb-update.mjs;
  environment.etc."murakumo/preflight.sh".source = archive/nixos/scripts/preflight.sh;
  environment.etc."murakumo/node-base.nix".source = ./node-base.nix;
  environment.etc."murakumo/community.nix".source = ./community.nix;
  environment.etc."murakumo/node-readiness.mjs".source = ./node-readiness.mjs;
  environment.etc."murakumo/device-claim.mjs".source = ./device-claim.mjs;
  environment.etc."murakumo/node-provider.nix".source = ./node-provider.nix;
  environment.etc."murakumo/node-claim.nix".source = ./node-claim.nix;
  environment.etc."murakumo/update-service.nix".source = ./update-service.nix;
  environment.etc."murakumo/update-policy-runtime".source = ./update-policy-runtime;
  environment.etc."murakumo/update-linux.mjs".source = ./update-linux.mjs;
  environment.etc."murakumo/update-policy.mjs".source = ./update-policy.mjs;
  environment.etc."murakumo/update-controller.mjs".source = ./update-controller.mjs;
  environment.etc."murakumo/update-release.mjs".source = ./update-release.mjs;
  environment.etc."murakumo/update-defaults.json".source = ./update-defaults.json;
  environment.etc."murakumo/console-ui.nix".source = ./console-ui.nix;
  environment.etc."murakumo/account-link-runtime.nix".source = ./account-link-runtime.nix;
  environment.etc."murakumo/node-root-receipt.mjs".source = ./node-root-receipt.mjs;
  environment.etc."murakumo/account-link.mjs".source = "${import ./account-link-runtime.nix { inherit pkgs; }}/account-link.mjs";
  environment.etc."murakumo/configuration.example.nix".source = ./configuration.example.nix;
  # Include complete installed systems, not just installation tools.
  isoImage.storeContents = [ uefi bios ];
  environment.etc."murakumo/offline-systems.json".text = builtins.toJSON {
    version = 2;
    uefi = toString uefi;
    bios = toString bios;
    rootLabel = "MURAKUMO_ROOT";
    bootLabel = "MURA_BOOT";
  };
  environment.etc."murakumo/offline-base.nix".source = ./offline-base.nix;
  environment.etc."murakumo/offline-uefi.nix".source = ./offline-uefi.nix;
  environment.etc."murakumo/offline-bios.nix".source = ./offline-bios.nix;
  # Enter the guided installer on boot. Formatting requires explicit disk approval.
  systemd.services."getty@tty1".enable = false;
  systemd.services.murakumo-install = {
    description = "Guided automatic Murakumo disk installation";
    wantedBy = [ "multi-user.target" ];
    wants = [ "seatd.service" ];
    after = [ "seatd.service" "systemd-vconsole-setup.service" "register-nix-paths.service" "NetworkManager.service" ];
    conflicts = [ "getty@tty1.service" ];
    path = with pkgs; [ nodejs_22 dialog networkmanager iproute2 parted dosfstools e2fsprogs grub2 util-linux systemd coreutils nixos-install-tools nix ];
    environment.TERM = "linux";
    environment.NIX_PATH = "nixpkgs=${pkgs.path}";
    serviceConfig = {
      Type = "oneshot";
      ExecStart = "${pkgs.bash}/bin/bash /etc/murakumo/launch-ui ${pkgs.nodejs_22}/bin/node /etc/murakumo/install-disk.mjs";
      RuntimeDirectory = [ "murakumo-ui" "murakumo-voice" ];
      RuntimeDirectoryMode = "0700";
      StandardInput = "tty-force";
      StandardOutput = "tty";
      StandardError = "tty";
      TTYPath = "/dev/tty1";
      TTYReset = true;
      TimeoutStartSec = "infinity";
      # Never automatically repeat a destructive install after a failure.
      RemainAfterExit = true;
    };
  };
}
