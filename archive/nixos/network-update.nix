{ config, lib, pkgs, ... }:
let
  cfg = config.services.murakumoNative.networkUpdates;
  contract = pkgs.writeText "murakumo-os-update-contract.json" (builtins.toJSON {
    schema = "murakumo.os-update.v1";
    inherit (cfg) hostId healthUnits confirmationSeconds startupGraceSeconds minimumHealthySeconds;
    system = pkgs.stdenv.hostPlatform.system;
    esp = config.boot.loader.efi.efiSysMountPoint;
    stateVersion = config.system.stateVersion;
  });
  command = pkgs.writeShellApplication {
    name = "murakumo-os-update";
    inheritPath = false;
    runtimeInputs = [ pkgs.nix pkgs.coreutils pkgs.util-linux pkgs.jq pkgs.systemd pkgs.diffutils pkgs.findutils pkgs.gawk pkgs.curl ];
    text = builtins.readFile ./network-update.sh;
  };
in {
  options.services.murakumoNative.networkUpdates = {
    enable = lib.mkEnableOption "operator-authorized SSH/Nix closure updates with one-shot UEFI trials";
    hostId = lib.mkOption { type = lib.types.str; default = config.networking.hostName; description = "Stable local host contract; not a network identity or admission."; };
    healthUnits = lib.mkOption { type = lib.types.listOf lib.types.str; default = [ "murakumo-node-monitor.service" "nginx.service" "sshd.service" ] ++ lib.optional config.services.murakumoNative.desktop "cage-tty1.service"; };
    confirmationSeconds = lib.mkOption { type = lib.types.ints.between 60 1800; default = 300; description = "Trial deadline in monotonic uptime; no remote confirmation means rollback."; };
    startupGraceSeconds = lib.mkOption { type = lib.types.ints.between 5 300; default = 60; };
    minimumHealthySeconds = lib.mkOption { type = lib.types.ints.between 5 120; default = 20; };
  };
  config = lib.mkIf cfg.enable {
    assertions = [
      { assertion = config.services.murakumoNative.enable && !config.services.murakumoNative.liveSession; message = "Network updates require an installed native Murakumo NixOS system, never a live ISO."; }
      { assertion = config.boot.loader.systemd-boot.enable && config.boot.loader.efi.canTouchEfiVariables; message = "Network update trials currently require systemd-boot and writable UEFI variables."; }
      { assertion = builtins.match "[a-z0-9-]{1,64}" cfg.hostId != null; message = "Network update hostId must be a stable bounded ASCII label."; }
      { assertion = cfg.healthUnits != [] && lib.all (u: builtins.match "[a-zA-Z0-9@_.-]+\\.service" u != null) cfg.healthUnits; message = "Network update healthUnits must name local system services."; }
      { assertion = cfg.confirmationSeconds > cfg.startupGraceSeconds + cfg.minimumHealthySeconds; message = "Trial confirmation deadline must allow startup and measured healthy time."; }
      { assertion = !(lib.attrByPath [ "boot" "lanzaboote" "enable" ] false config); message = "Signed UKI/Secure Boot updates require a separately qualified adapter."; }
      { assertion = !config.system.autoUpgrade.enable; message = "Use one OS update authority; channel auto-upgrade must be disabled."; }
    ];
    environment.etc."murakumo/os-update.json".source = contract;
    environment.systemPackages = [ command ];
    system.build.murakumoNetworkUpdate = command;
    # These are NixOS/platform administration tools, separate from the native
    # monitor and browser app. They do not open an app API or provision SSH keys.
    systemd.services.murakumo-os-update-apply = {
      description = "Prepare a retained fallback and one-shot Murakumo OS trial";
      after = [ "local-fs.target" ];
      restartIfChanged = false;
      stopIfChanged = false;
      serviceConfig = { Type = "oneshot"; ExecStart = "${command}/bin/murakumo-os-update _apply"; TimeoutStartSec = 300; UMask = "0077"; };
    };
    systemd.services.murakumo-os-update-guard = {
      description = "Recover or roll back an unconfirmed Murakumo OS trial";
      after = [ "local-fs.target" ];
      restartIfChanged = false;
      serviceConfig = { Type = "oneshot"; ExecStart = "${command}/bin/murakumo-os-update _guard"; TimeoutStartSec = 90; UMask = "0077"; };
    };
    systemd.timers.murakumo-os-update-guard = {
      wantedBy = [ "timers.target" ];
      timerConfig = { OnBootSec = "10s"; OnUnitInactiveSec = "5s"; AccuracySec = "1s"; };
    };
    # No auto-upgrade/channel following, key generation, password login,
    # remote root grant, firewall change, or automatic generation GC.
  };
}
