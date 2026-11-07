{ config, lib, pkgs, ... }:
let
  cfg = config.otehon.backup;
  stateDir = "/var/lib/otehon";
  keyDir = "${stateDir}/backup";
  name = "otehon";
in
{
  # Encrypted backup of the Otehon state volume with restic (ADR 0026 D8 and D17 stage 2,
  # AWAI-166). It needs base-module.nix: the restic repository key is kept on the encrypted
  # state volume, next to the age key. On the first boot of a volume the key is copied from
  # the key disk, so a new disk with the same key disk can restore the backup.
  #
  # The NixOS restic module does the backup. It has no timer unless `timerConfig` is set.
  # Restore is `restic-otehon restore latest --target /`.
  options.otehon.backup = {
    repository = lib.mkOption {
      type = lib.types.str;
      default = "/mnt/otehon-backup/restic";
      description = "restic repository. The default is a directory on a mounted share.";
    };
    paths = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ stateDir ];
      description = "Paths to back up.";
    };
    exclude = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ "${stateDir}/age.key" keyDir "${stateDir}/lost+found" ];
      description = "Keys stay out of the backup. They come from the key disk on a new disk.";
    };
    keyDisk = lib.mkOption {
      type = lib.types.str;
      default = "/dev/disk/by-id/virtio-otehon-key";
      description = "Key disk, a tar archive. Its member restic.key is the repository key.";
    };
    timerConfig = lib.mkOption {
      type = lib.types.nullOr (lib.types.attrsOf lib.types.str);
      default = null;
      description = "Schedule for the backup. null means no schedule: start it by hand.";
    };
  };

  config = {
    # Copies the repository key from the key disk to the state volume once. A key that is
    # already on the volume is kept, so a different key disk cannot replace it later.
    systemd.services.otehon-backup-key = {
      description = "Install the restic repository key on the state volume";
      wantedBy = [ "multi-user.target" ];
      after = [ "otehon-state.service" ];
      requires = [ "otehon-state.service" ];
      unitConfig.RequiresMountsFor = [ stateDir ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
      };
      path = with pkgs; [ coreutils gnutar util-linux ];
      script = ''
        mountpoint -q ${stateDir} || { echo "otehon-backup-key: state volume not mounted"; exit 1; }
        [ -e ${keyDir}/restic.key ] && exit 0
        tmp=$(mktemp -d /run/otehon-backup-key.XXXXXX)
        trap 'rm -rf "$tmp"' EXIT
        tar -xf ${cfg.keyDisk} -C "$tmp" restic.key || { echo "otehon-backup-key: no restic.key on the key disk"; exit 1; }
        [ -s "$tmp/restic.key" ] || { echo "otehon-backup-key: empty restic.key"; exit 1; }
        install -d -m 700 ${keyDir} ${keyDir}/cache
        install -m 400 "$tmp/restic.key" ${keyDir}/restic.key
      '';
    };

    services.restic.backups.${name} = {
      inherit (cfg) repository paths exclude timerConfig;
      passwordFile = "${keyDir}/restic.key";
      initialize = true;
      createWrapper = true;
      extraBackupArgs = [ "--one-file-system" ];
    };

    systemd.services."restic-backups-${name}" = {
      after = [ "otehon-backup-key.service" ];
      requires = [ "otehon-backup-key.service" ];
      unitConfig.RequiresMountsFor = [ stateDir ] ++ lib.optional (lib.hasPrefix "/" cfg.repository) cfg.repository;
      # The module puts the cache on the root partition, which is not encrypted.
      environment.RESTIC_CACHE_DIR = lib.mkForce "${keyDir}/cache";
    };
  };
}
