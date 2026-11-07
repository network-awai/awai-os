{ config, lib, pkgs, ... }:
let
  feed = "/run/otehon-feed";
  stateFile = "/var/lib/otehon-update-check-stage";
in
{
  # Check image for update.nix, not a release. The keys in fixtures/update are test keys.
  # update-check-qemu.sh reads the reports. Each stage runs after the boot has settled.
  imports = [ ./common.nix ./update.nix ./update-test-keys.nix ];

  system.image.id = "awai-otehon-update";
  system.image.version = lib.mkDefault "1";
  environment.etc."otehon-generation".text = lib.mkDefault "a";

  boot.kernelModules = [ "9p" "9pnet_virtio" ];
  fileSystems.${feed} = {
    device = "otehon-feed";
    fsType = "9p";
    options = [ "trans=virtio" "version=9p2000.L" "ro" "msize=1048576" "nofail" "x-systemd.device-timeout=5s" ];
  };

  systemd.services.otehon-boot-report = {
    after = [ "multi-user.target" "otehon-update-settle.service" ];
    path = [ config.nix.package pkgs.gnugrep pkgs.util-linux "/run/current-system/sw" ];
    script = ''
      # A failed trial is rebooting now, and nothing below may race it.
      if [ -e /var/lib/otehon-update/pending.json ]; then
        echo "OTEHON_UPDATE_REPORT generation=$(cat /etc/otehon-generation) trial=unsettled"
        exit 0
      fi
      stage=$(cat ${stateFile} 2>/dev/null || echo 0)
      generation=$(cat /etc/otehon-generation)
      version=$(otehon-update version)
      failed=$(systemctl list-units --state=failed --no-legend | wc -l)
      echo "OTEHON_UPDATE_REPORT stage=$stage generation=$generation version=$version failed=$failed"

      # Prints the first word after REFUSED, or "accepted".
      probe() {
        out=$(otehon-update check "$1" 2>&1 || true)
        case "$out" in
          *REFUSED*) echo "$out" | sed -E 's/.*REFUSED ([a-z-]+).*/\1/' ;;
          *) echo accepted ;;
        esac
      }
      case "$stage" in
        0)
          # The accepted probe proves the refusals are not refusing everything.
          echo "OTEHON_UPDATE_PROBE good=$(probe ${feed}/good) unsigned=$(probe ${feed}/unsigned) wrong_key=$(probe ${feed}/wrong-key) tampered=$(probe ${feed}/tampered)"
          bad_closure=$(otehon-update apply ${feed}/unsigned-closure 2>&1 | tail -1 || true)
          case "$bad_closure" in *REFUSED*bad-closure*) echo "OTEHON_UPDATE_PROBE unsigned_closure=bad-closure" ;; *) echo "OTEHON_UPDATE_PROBE unsigned_closure=[$bad_closure]" ;; esac
          rm -f /var/lib/otehon-update/pending.json
          otehon-update apply ${feed}/good
          echo 1 > ${stateFile}
          sync
          systemctl reboot --no-block
          ;;
        1)
          echo "OTEHON_UPDATE_PROBE downgrade=$(probe ${feed}/downgrade)"
          otehon-update apply ${feed}/bad
          echo 2 > ${stateFile}
          sync
          systemctl reboot --no-block
          ;;
        2)
          echo "OTEHON_UPDATE_PROBE retry_bad=$(probe ${feed}/bad)"
          echo 3 > ${stateFile}
          sync
          systemctl reboot --no-block
          ;;
        3)
          echo "OTEHON_UPDATE_DONE generation=$generation version=$version entries=$(ls /boot/loader/entries | tr '\n' ',')"
          sleep 2
          systemctl poweroff --no-block
          ;;
      esac
    '';
  };
}
