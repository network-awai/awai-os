{ config, lib, pkgs, ... }:
let
  feed = "/run/otehon-feed";
  pending = "/var/lib/otehon-update/pending.json";
  stateFile = "/var/lib/otehon-desktop-update-stage";
in
{
  # Check image: updates on the real desktop profile. The feed timer stages version 2, then a
  # failing version 3 must roll back. desktop-update-check-qemu.sh reads the lines. Not a release.
  imports = [ ./desktop.nix ./update-test-keys.nix ];

  system.image.id = lib.mkForce "awai-otehon-desktop-update";
  environment.etc."otehon-generation".text = lib.mkDefault "a";

  otehon.update = {
    feed = "${feed}/good";
    feedSchedule = "*:*:0/30";
  };

  boot.kernelModules = [ "9p" "9pnet_virtio" ];
  fileSystems.${feed} = {
    device = "otehon-feed";
    fsType = "9p";
    options = [ "trans=virtio" "version=9p2000.L" "ro" "msize=1048576" "nofail" "x-systemd.device-timeout=5s" ];
  };

  systemd.services.otehon-desktop-update-driver = {
    description = "Drive the desktop update check";
    wantedBy = [ "graphical.target" ];
    after = [ "graphical.target" "otehon-boot-report.service" "otehon-update-settle.service" ];
    path = [ config.otehon.update.package pkgs.gnugrep pkgs.gnused pkgs.jq pkgs.util-linux "/run/current-system/sw" ];
    serviceConfig = {
      Type = "oneshot";
      TimeoutStartSec = "infinity";
      StandardOutput = "tty";
      StandardError = "tty";
      TTYPath = "/dev/console";
    };
    script = ''
      say() { echo "OTEHON_DESKTOP_UPDATE $*"; }
      # A failed trial is rebooting now, and nothing below may race it.
      if [ -e ${pending} ] && [ "$(jq -r .system ${pending})" = "$(readlink -f /run/current-system)" ]; then
        say trial=unsettled
        exit 0
      fi
      stage=$(cat ${stateFile} 2>/dev/null || echo 0)
      generation=$(cat /etc/otehon-generation)
      version=$(otehon-update version)
      failed=$(systemctl list-units --state=failed --no-legend | wc -l)
      say "REPORT stage=$stage generation=$generation version=$version failed=$failed"
      next() { echo "$1" > ${stateFile}; sync; systemctl reboot --no-block; }
      case "$stage" in
        0)
          # Only the timer may stage this one. The driver does not call apply.
          for _ in $(seq 1 300); do
            state=$(systemctl show -p ActiveState --value otehon-update-feed.service)
            [ -e ${pending} ] && [ "$state" != activating ] && break
            sleep 2
          done
          [ -e ${pending} ] || say "FAIL the timer staged nothing"
          next 1
          ;;
        1)
          # The timer keeps looking, and must refuse what is now installed.
          for _ in $(seq 1 60); do
            journalctl -b -u otehon-update-feed -o cat | grep -q 'REFUSED old-version' && break
            sleep 2
          done
          say "timer_again=$(journalctl -b -u otehon-update-feed -o cat | grep -o 'REFUSED old-version' | tail -1 | sed 's/REFUSED //')"
          otehon-update apply ${feed}/bad
          next 2
          ;;
        2)
          say "retry_bad=$(otehon-update check ${feed}/bad 2>&1 | sed -E 's/.*REFUSED ([a-z-]+).*/\1/')"
          say "DONE generation=$generation version=$version entries=$(ls /boot/loader/entries | tr '\n' ',')"
          sleep 2
          systemctl poweroff --no-block
          ;;
      esac
    '';
  };
}
