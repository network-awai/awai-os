{ pkgs, lib, config, ... }:
{
  options.services.murakumoAccountLink.enable = lib.mkEnableOption "passwordless first-boot Murakumo registration";
  options.services.murakumoDeviceClaim.enable = lib.mkEnableOption "standalone Murakumo device claim and signed heartbeat agent (alternative to services.murakumoClaimResponder; enable exactly one)";
  imports = [ ./console-ui.nix ./update-service.nix ./remote-access.nix ./community.nix ./node-provider.nix ./node-claim.nix ];
  config = {
  assertions = [
    { assertion = !(config.services.murakumoDeviceClaim.enable && config.services.murakumoClaimResponder.enable);
      message = "Enable exactly one claim agent: services.murakumoDeviceClaim (standalone device-claim.mjs) or services.murakumoClaimResponder (CLI claim-once), never both."; }
    { assertion = !(config.services.murakumoCommunity.enable && config.services.murakumoProvider.enable);
      message = "Enable exactly one community join service: services.murakumoCommunity or services.murakumoProvider, never both."; }
  ];
  # Base for a NixOS Murakumo node after the OS is installed.
  services.tailscale.enable = true;
  services.murakumoRemote.enable = true;
  hardware.graphics.enable = true;
  environment.systemPackages = with pkgs; [
    curl
    nodejs_22
    vulkan-tools
    qrencode
  ];
  # Reference update mechanism shipped disabled: no timer or boot activation
  # until signed release roots, owner policy and recovery providers qualify.
  environment.etc."murakumo/update-release.mjs".source = ./update-release.mjs;
  environment.etc."murakumo/update-controller.mjs".source = ./update-controller.mjs;
  environment.etc."murakumo/update-defaults.json".source = ./update-defaults.json;
  environment.etc."murakumo/account-link.mjs".source = "${import ./account-link-runtime.nix { inherit pkgs; }}/account-link.mjs";
  systemd.services."getty@tty1".enable = lib.mkIf config.services.murakumoAccountLink.enable false;
  systemd.services.murakumo-account-link = lib.mkIf config.services.murakumoAccountLink.enable {
    description = "Set up this Murakumo device locally or link an account";
    wantedBy = [ "multi-user.target" ];
    wants = [ "network.target" "seatd.service" ];
    after = [ "network.target" "seatd.service" ];
    conflicts = [ "getty@tty1.service" ];
    path = with pkgs; [ qrencode dialog networkmanager iproute2 systemd ];
    environment.HOME = "/var/lib/murakumo";
    serviceConfig = {
      Type = "simple";
      RemainAfterExit = true;
      ExecStart = "${pkgs.bash}/bin/bash /etc/murakumo/launch-ui ${pkgs.nodejs_22}/bin/node /etc/murakumo/setup-ui.mjs";
      # Provision update consent without making all of /var writable.
      StateDirectory = [ "murakumo" "aiueos-update" ];
      StateDirectoryMode = "0700";
      RuntimeDirectory = [ "murakumo-ui" "murakumo-voice" ];
      RuntimeDirectoryMode = "0700";
      StandardInput = "tty-force";
      StandardOutput = "tty";
      StandardError = "tty";
      TTYPath = "/dev/tty1";
      TTYReset = true;
      Restart = "on-failure";
      RestartSec = 15;
      NoNewPrivileges = true;
      ProtectSystem = "strict";
      ProtectHome = true;
      TimeoutStartSec = "infinity";
    };
  };
  environment.etc."murakumo/node-readiness.mjs".source = ./node-readiness.mjs;
  environment.etc."murakumo/device-claim.mjs".source = ./device-claim.mjs;
  systemd.services.murakumo-device-claim = lib.mkIf config.services.murakumoDeviceClaim.enable {
    description = "Murakumo device claim and signed heartbeat";
    wantedBy = [ "multi-user.target" ];
    wants = [ "network-online.target" ];
    after = [ "network-online.target" ];
    unitConfig.ConditionPathExists = "/var/lib/murakumo/device-identity.json";
    serviceConfig = {
      Type = "simple";
      StateDirectory = "murakumo";
      StateDirectoryMode = "0700";
      ExecStart = "${pkgs.nodejs_22}/bin/node /etc/murakumo/device-claim.mjs serve";
      Restart = "always";
      RestartSec = 10;
      NoNewPrivileges = true;
      ProtectSystem = "strict";
      ProtectHome = true;
    };
  };
  # Hardware, disks, model server, credentials, admission and firewall are
  # supplied by the operator's host configuration.
  };
}
