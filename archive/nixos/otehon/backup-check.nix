{ config, lib, pkgs, modulesPath, ... }:
let
  stateDir = "/var/lib/otehon";
  share = "/mnt/otehon-backup";
  modeFile = "/sys/firmware/qemu_fw_cfg/by_name/opt/otehon/mode/raw";
in
{
  # Headless check image for backup.nix, not a release. The test keys are in fixtures/backup.
  # QEMU passes the mode (backup, restore or verify) through fw_cfg, and the backup target is
  # a 9p share. backup-check-qemu.sh reads the reports.
  imports = [
    ./base-module.nix
    ./backup.nix
    "${modulesPath}/profiles/minimal.nix"
  ];

  system.image.id = "awai-otehon-backup";
  system.image.version = "0.1.0";

  sops.secrets.otehon-test-value.sopsFile = ./fixtures/base-secret.yaml;

  boot.kernelModules = [ "9p" "9pnet_virtio" "qemu_fw_cfg" ];
  fileSystems.${share} = {
    device = "otehon-backup";
    fsType = "9p";
    options = [ "trans=virtio" "version=9p2000.L" "msize=1048576" "nofail" "x-systemd.device-timeout=5s" ];
  };

  systemd.services.otehon-boot-report = {
    after = [ "multi-user.target" "otehon-backup-key.service" "sops-install-secrets.service" ];
    path = with pkgs; [ coreutils findutils gnugrep gnused util-linux "/run/current-system/sw" ];
    script = ''
      mode=$(cat ${modeFile} 2>/dev/null || echo none)
      state=0; mountpoint -q ${stateDir} && state=1
      target=0; mountpoint -q ${share} && target=1
      key=0; [ -s ${stateDir}/backup/restic.key ] && key=1

      # A hash over the names, types, modes and contents of the data tree.
      tree_hash() {
        [ -d ${stateDir}/data ] || { echo empty; return; }
        cd ${stateDir}
        {
          find data -printf '%p %y %m\n' | LC_ALL=C sort
          find data -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum
        } | sha256sum | cut -c1-16
      }
      # Prints the cause of a failed restic run from its output.
      reason() {
        if grep -q 'wrong password or no key found' "$1"; then echo wrong-password
        elif grep -qiE 'ciphertext verification failed|contains errors|hash does not match|invalid data returned' "$1"; then echo integrity
        else echo other; fi
      }
      # restic output goes to the console, prefixed, so the evidence shows the real message.
      run() {
        log=$1; shift
        rc=0; "$@" > "$log" 2>&1 || rc=$?
        tail -n 8 "$log" | sed 's/^/OTEHON_BACKUP_LOG /'
        return $rc
      }
      out=/run/otehon-backup-check
      install -d -m 700 $out
      failed() { systemctl list-units --state=failed --no-legend | wc -l; }

      case "$mode" in
        backup)
          install -d -m 700 ${stateDir}/data/notes
          # The strings are joined here, so they reach a disk only when written.
          printf 'OTEHON_%s_%s\n' BACKUP CANARY > ${stateDir}/data/canary
          cat /proc/sys/kernel/random/uuid >> ${stateDir}/data/canary
          head -c 4194304 /dev/urandom > ${stateDir}/data/random.bin
          echo "note written at first boot" > ${stateDir}/data/notes/a.txt
          chmod 600 ${stateDir}/data/notes/a.txt
          # A plain file next to the repository proves the host search can see the share.
          [ "$target" = 1 ] && printf 'OTEHON_%s_%s\n' SHARE PLAIN > ${share}/plain-canary
          sync
          hash=$(tree_hash)
          backup=fail; run $out/backup systemctl start restic-backups-otehon.service && backup=ok
          journalctl -u restic-backups-otehon.service --no-pager -o cat | tail -n 6 | sed 's/^/OTEHON_BACKUP_LOG /'
          snapshots=$(restic-otehon snapshots --json 2>/dev/null | grep -o '"short_id"' | wc -l)
          check=fail; run $out/check restic-otehon check --read-data && check=ok
          echo "OTEHON_BACKUP_REPORT mode=backup state=$state target=$target key=$key hash=$hash backup=$backup snapshots=$snapshots check=$check failed=$(failed)"
          ;;
        restore)
          pre=$(tree_hash)
          restore=fail; why=none
          if run $out/restore restic-otehon restore latest --target /; then restore=ok; else why=$(reason $out/restore); fi
          hash=$(tree_hash)
          check=fail; run $out/check restic-otehon check --read-data && check=ok
          echo "OTEHON_BACKUP_REPORT mode=restore state=$state target=$target key=$key pre=$pre restore=$restore reason=$why hash=$hash check=$check failed=$(failed)"
          ;;
        verify)
          check=fail; why=none
          if run $out/check restic-otehon check --read-data; then check=ok; else why=$(reason $out/check); fi
          restore=fail; why2=none
          if run $out/restore restic-otehon restore latest --target $out/restored; then restore=ok; else why2=$(reason $out/restore); fi
          echo "OTEHON_BACKUP_REPORT mode=verify state=$state target=$target key=$key check=$check reason=$why restore=$restore restore_reason=$why2 failed=$(failed)"
          ;;
        *)
          echo "OTEHON_BACKUP_REPORT mode=none state=$state target=$target key=$key failed=$(failed)"
          ;;
      esac
      sync
      systemctl poweroff --no-block
    '';
  };
}
