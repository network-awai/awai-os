{ config, lib, pkgs, ... }:
let
  cfg = config.otehon.update.network;
  updater = pkgs.writeShellApplication {
    name = "otehon-update-network";
    runtimeInputs = [ pkgs.python3 pkgs.util-linux config.nix.package config.system.build.otehonUpdate ];
    text = ''
      exec flock -n /var/lib/otehon-update/network.lock python3 ${./update-network.py} /etc/otehon-update/network.json
    '';
  };
  contract = {
    inherit (cfg) feedUrl channel cohort maintenanceHours automaticReboot maxDownloadBytes maxImportBytes maxStorePaths minimumFreeBytes maxValiditySeconds;
    architecture = pkgs.stdenv.hostPlatform.parsed.cpu.name;
    stateContract = "chromium-${pkgs.chromium.version}-otehon-origin-v2";
    caBundle = toString cfg.caBundle;
    cacheKey = toString config.otehon.update.cacheKey;
    stateDirectory = "/var/lib/otehon-update";
  };
in {
  options.otehon.update.network = {
    enable = lib.mkEnableOption "owner-enrolled HTTPS polling for signed Otehon releases";
    feedUrl = lib.mkOption { type = lib.types.str; description = "Explicit HTTPS release directory; no redirects, credentials or queries."; };
    channel = lib.mkOption { type = lib.types.enum [ "stable" "canary" ]; default = "stable"; };
    cohort = lib.mkOption { type = lib.types.strMatching "[a-z0-9][a-z0-9-]{0,63}"; default = "stable"; };
    interval = lib.mkOption { type = lib.types.str; default = "30min"; };
    maintenanceHours = lib.mkOption { type = lib.types.listOf (lib.types.ints.between 0 23); default = [ 3 4 ]; };
    automaticReboot = lib.mkOption { type = lib.types.bool; default = false; description = "Explicit standing owner enrollment for trial reboot after verified staging."; };
    maxDownloadBytes = lib.mkOption { type = lib.types.ints.positive; default = 8 * 1024 * 1024 * 1024; };
    maxImportBytes = lib.mkOption { type = lib.types.ints.positive; default = 16 * 1024 * 1024 * 1024; };
    minimumFreeBytes = lib.mkOption { type = lib.types.ints.positive; default = 2 * 1024 * 1024 * 1024; };
    maxStorePaths = lib.mkOption { type = lib.types.ints.between 1 100000; default = 50000; };
    maxValiditySeconds = lib.mkOption { type = lib.types.ints.positive; default = 7 * 24 * 3600; };
    caBundle = lib.mkOption { type = lib.types.path; default = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"; };
  };
  config = lib.mkIf cfg.enable {
    assertions = [
      { assertion = config.otehon.update.enable; message = "Network polling requires the signed Otehon generation updater."; }
      { assertion = builtins.match "https://[^?#@ ]+" cfg.feedUrl != null; message = "Otehon feeds require an explicit HTTPS URL without credentials/query/fragment."; }
      { assertion = !config.system.autoUpgrade.enable; message = "Only one enrolled OS update authority may run."; }
    ];
    environment.etc."otehon-update/network.json".text = builtins.toJSON contract;
    environment.systemPackages = [ updater ];
    systemd.services.otehon-update-poll = {
      description = "Poll the enrolled signed HTTPS release feed";
      after = [ "network-online.target" "time-sync.target" "otehon-update-settle.service" ];
      wants = [ "network-online.target" ];
      environment = {
        OTEHON_UPDATE_BASE_VERSION = toString config.otehon.update.baseVersion;
        OTEHON_UPDATE_PUBLIC_KEY = toString config.otehon.update.publicKey;
        OTEHON_UPDATE_CACHE_KEY = toString config.otehon.update.cacheKey;
      };
      restartIfChanged = false;
      serviceConfig = { Type = "oneshot"; ExecStart = lib.getExe updater; UMask = "0077"; TimeoutStartSec = "30min"; };
    };
    systemd.timers.otehon-update-poll = {
      wantedBy = [ "timers.target" ];
      timerConfig = { OnBootSec = "5min"; OnUnitInactiveSec = cfg.interval; RandomizedDelaySec = "2min"; Persistent = true; };
    };
  };
}
