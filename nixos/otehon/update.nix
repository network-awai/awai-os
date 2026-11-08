{ config, lib, pkgs, ... }:
let
  cfg = config.otehon.update;
  efiArch = config.nixpkgs.hostPlatform.efiArch;
  # Nothing but the image sets these, so every caller of the command sees the same keys.
  settings = ''
    export OTEHON_UPDATE_BASE_VERSION=${toString cfg.baseVersion}
    export OTEHON_UPDATE_PUBLIC_KEY=${cfg.publicKey}
    export OTEHON_UPDATE_CACHE_KEY=${cfg.cacheKey}
    export OTEHON_UPDATE_FEED=${lib.escapeShellArg (if cfg.networkFeed != null then cfg.networkFeed else if cfg.feed == null then "none" else cfg.feed)}
  '';
  testKeys = [ ./fixtures/update/test-manifest.pub ./fixtures/update/test-cache.pub ];
  closure = pkgs.closureInfo { rootPaths = [ config.system.build.toplevel ]; };
  initialUki = config.system.boot.loader.ukiFile;
  initialUkiMarker = pkgs.runCommand "otehon-initial-uki-marker" { } ''
    digest=$(sha256sum ${config.system.build.uki}/${lib.escapeShellArg initialUki} | cut -d ' ' -f 1)
    printf '%s %s\n' "$digest" ${lib.escapeShellArg initialUki} > "$out"
  '';
  command = pkgs.writeShellApplication {
    name = "otehon-update";
    runtimeInputs = with pkgs; [ config.nix.package config.systemd.package coreutils curl findutils gnused gnugrep jq minisign util-linux ];
    text = settings + builtins.readFile ./update.sh;
    # The script defines its own strict mode, and shellcheck has no view of the Nix paths.
    bashOptions = [ ];
    excludeShellChecks = [ "SC2155" ];
  };
in
{
  # Signed updates with a trial boot and automatic fallback (update.sh). A trial uses systemd-boot
  # boot counting on the ESP, so it does not depend on writable EFI variables.
  #
  # These three have no default on purpose: the image builder supplies them, so a build that
  # forgot them fails instead of trusting a key from this repository.
  options.otehon.update = {
    baseVersion = lib.mkOption {
      type = lib.types.ints.positive;
      description = "The update version this image starts at. Older versions are refused.";
    };
    publicKey = lib.mkOption {
      type = lib.types.path;
      description = "minisign public key that signs update manifests.";
    };
    cacheKey = lib.mkOption {
      type = lib.types.path;
      description = "File with the Nix public key that signs the update closure.";
    };
    allowTestKeys = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Allow the keys in fixtures/update, whose private halves are public. Check images only.";
    };
    feed = lib.mkOption {
      type = lib.types.nullOr (lib.types.strMatching "/.*");
      default = null;
      description = ''
        A local directory holding a signed feed, such as a mounted medium. Null means no schedule
        and no background update. This is not a network location: nothing here fetches from a
        server, and a staged update waits for the next reboot, which this module does not start.
      '';
    };
    feedSchedule = lib.mkOption {
      type = lib.types.str;
      default = "daily";
      description = "systemd OnCalendar expression for looking in the feed directory.";
    };
    networkFeed = lib.mkOption {
      type = lib.types.nullOr (lib.types.strMatching "https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?(/[A-Za-z0-9._~-]+)*");
      default = null;
      description = "HTTPS base of a signed update feed. Null disables network checks. Staged updates wait for a reboot.";
    };
    package = lib.mkOption {
      type = lib.types.package;
      readOnly = true;
      default = command;
      description = "The otehon-update command.";
    };
  };

  config = {
    # This marker belongs to the image, not to the system closure: referring to
    # the UKI from the updater executable would create a build dependency cycle.
    image.repart.partitions.esp.contents."/EFI/Awai/initial-uki.sha256".source = initialUkiMarker;
    assertions = [{
      assertion = cfg.allowTestKeys || !lib.elem (builtins.readFile cfg.publicKey) (map builtins.readFile testKeys)
        && !lib.elem (builtins.readFile cfg.cacheKey) (map builtins.readFile testKeys);
      message = "otehon.update: this image would trust a test key from fixtures/update. Supply real public keys, or set allowTestKeys in a check image.";
    } {
      assertion = cfg.feed == null || cfg.networkFeed == null;
      message = "otehon.update: choose either a local or network feed, not both.";
    }];

    environment.systemPackages = [ command ];

    boot.loader.systemd-boot.enable = true;
    boot.loader.efi.canTouchEfiVariables = false;
    boot.loader.timeout = 0;
    fileSystems."/boot" = {
      device = "/dev/disk/by-partlabel/otehon-esp";
      fsType = "vfat";
      options = [ "umask=0077" ];
    };

    # The image holds the store without a Nix database, which generations need.
    systemd.services.otehon-nix-db = {
      description = "Register the image store paths in the Nix database";
      wantedBy = [ "multi-user.target" ];
      before = [ "multi-user.target" ];
      unitConfig.ConditionPathExists = "/nix-path-registration";
      serviceConfig.Type = "oneshot";
      path = [ config.nix.package pkgs.coreutils ];
      script = ''
        nix-store --load-db < /nix-path-registration
        rm /nix-path-registration
      '';
    };

    systemd.tmpfiles.rules = [ "d /var/lib/otehon-update 0700 root root -" ];

    # systemd-bless-boot marks a boot good after boot-complete.target, which this unit must pass.
    systemd.services.otehon-update-health = {
      description = "Check that this boot is healthy";
      wantedBy = [ "boot-complete.target" "multi-user.target" ];
      requiredBy = [ "boot-complete.target" ];
      before = [ "boot-complete.target" ];
      after = [ "multi-user.target" ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        ExecStart = "${lib.getExe command} health";
        StandardOutput = "journal+console";
        StandardError = "journal+console";
      };
    };

    systemd.services.otehon-update-settle = {
      description = "Confirm or roll back a trial update";
      wantedBy = [ "multi-user.target" ];
      after = [ "multi-user.target" "otehon-nix-db.service" "otehon-update-health.service" ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        ExecStart = "${lib.getExe command} settle";
        StandardOutput = "journal+console";
        StandardError = "journal+console";
      };
    };

    # A refused feed exits 2. That is an answer, not a failure of this service.
    systemd.services.otehon-update-feed = lib.mkIf (cfg.feed != null) {
      description = "Stage a signed update from the local feed directory";
      after = [ "otehon-nix-db.service" "otehon-update-settle.service" ];
      path = [ pkgs.util-linux "/run/current-system/sw" ];
      serviceConfig = {
        Type = "oneshot";
        ExecStart = "${lib.getExe command} apply ${cfg.feed}";
        SuccessExitStatus = 2;
        StandardOutput = "journal+console";
        StandardError = "journal+console";
      };
    };
    systemd.timers.otehon-update-feed = lib.mkIf (cfg.feed != null) {
      description = "Look in the local feed directory for a signed update";
      wantedBy = [ "timers.target" ];
      timerConfig.OnCalendar = cfg.feedSchedule;
    };
    systemd.services.otehon-update-network = lib.mkIf (cfg.networkFeed != null) {
      description = "Stage a signed update from the configured HTTPS feed";
      wants = [ "network-online.target" ];
      after = [ "network-online.target" "otehon-nix-db.service" "otehon-update-settle.service" ];
      serviceConfig = {
        Type = "oneshot";
        ExecStart = "${lib.getExe command} apply-https ${lib.escapeShellArg cfg.networkFeed}";
        SuccessExitStatus = 3;
        StandardOutput = "journal+console";
        StandardError = "journal+console";
      };
    };
    systemd.timers.otehon-update-network = lib.mkIf (cfg.networkFeed != null) {
      description = "Check the configured HTTPS update feed";
      wantedBy = [ "timers.target" ];
      timerConfig = { OnCalendar = cfg.feedSchedule; Persistent = true; RandomizedDelaySec = "15m"; };
    };

    image.repart.partitions = {
      esp.contents."/EFI/systemd/systemd-boot${efiArch}.efi".source =
        "${pkgs.systemd}/lib/systemd/boot/efi/systemd-boot${efiArch}.efi";
      esp.repartConfig = {
        Label = "otehon-esp";
        SizeMinBytes = "512M";
      };
      root.contents."/nix-path-registration".source = "${closure}/registration";
    };
  };
}
