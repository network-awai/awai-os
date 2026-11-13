{ config, lib, pkgs, ... }:
let
  cfg = config.otehon.update;
  efiArch = config.nixpkgs.hostPlatform.efiArch;
  updateEnv = {
    OTEHON_UPDATE_BASE_VERSION = toString cfg.baseVersion;
    OTEHON_UPDATE_PUBLIC_KEY = "${cfg.publicKey}";
    OTEHON_UPDATE_CACHE_KEY = "${cfg.cacheKey}";
    OTEHON_UPDATE_HEALTH_CHECK = if cfg.healthCheck == null then "" else lib.getExe cfg.healthCheck;
  };
  closure = pkgs.closureInfo { rootPaths = [ config.system.build.toplevel ]; };
  command = pkgs.writeShellApplication {
    name = "otehon-update";
    runtimeInputs = with pkgs; [ config.nix.package config.systemd.package coreutils findutils gnused gnugrep jq minisign util-linux ];
    text = builtins.readFile ./update.sh;
    # The script defines its own strict mode, and shellcheck has no view of the Nix paths.
    bashOptions = [ ];
    excludeShellChecks = [ "SC2155" ];
  };
in
{
  # Signed updates with a trial boot and automatic fallback (update.sh). A trial uses systemd-boot
  # boot counting on the ESP, so it does not depend on writable EFI variables.
  options.otehon.update = {
    enable = lib.mkEnableOption "signed Otehon OS generation trials";
    healthCheck = lib.mkOption { type = lib.types.nullOr lib.types.package; default = null; description = "Additional local desktop readiness check before blessing a boot."; };
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
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ command ];
    system.build.otehonUpdate = command;
    environment.sessionVariables = updateEnv;

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
      environment = updateEnv;
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
      environment = updateEnv;
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
