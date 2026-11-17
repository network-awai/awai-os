{ config, lib, pkgs, ... }:
let
  expectedSecret = "otehon-base-fixture-value";
  stateDir = "/var/lib/otehon";
  profile = "/nix/var/nix/profiles/system";
  listener = port: {
    description = "Test listener on port ${toString port}";
    wantedBy = [ "multi-user.target" ];
    after = [ "network.target" ];
    serviceConfig.ExecStart =
      "${lib.getExe pkgs.socat} TCP-LISTEN:${toString port},fork,reuseaddr SYSTEM:'echo OTEHON_PORT_OPEN'";
  };
in
{
  # Check image for base-module.nix. It is not a release: the fixture key opens the
  # fixture secret, and the boot report below drives the generation test.
  # base-check-qemu.sh reads the reports.
  imports = [ ./base-module.nix ];

  system.image.id = "awai-otehon-base";
  system.image.version = "0.4.0";

  environment.etc."otehon-generation".text = lib.mkDefault "a";
  specialisation.update.configuration.environment.etc."otehon-generation".text = "b";

  sops.secrets.otehon-test-value.sopsFile = ./fixtures/base-secret.yaml;

  networking.firewall.allowedTCPPorts = [ 8443 ];
  systemd.services.otehon-port-allowed = listener 8443;
  systemd.services.otehon-port-closed = listener 8444;

  systemd.services.otehon-boot-report = {
    after = [ "otehon-nix-db.service" "otehon-port-allowed.service" "otehon-port-closed.service" ];
    path = with pkgs; [ config.nix.package gnugrep socat util-linux ];
    script = ''
      gen=$(cat /etc/otehon-generation)
      state=0; mountpoint -q ${stateDir} && state=1
      sops=0
      [ "$(cat /run/secrets/otehon-test-value 2>/dev/null || true)" = "${expectedSecret}" ] && sops=1
      listeners=0
      sleep 1
      a=$(socat -T 3 - TCP:127.0.0.1:8443 </dev/null 2>/dev/null || true)
      b=$(socat -T 3 - TCP:127.0.0.1:8444 </dev/null 2>/dev/null || true)
      [ "$a" = OTEHON_PORT_OPEN ] && [ "$b" = OTEHON_PORT_OPEN ] && listeners=1
      failed=$(systemctl list-units --state=failed --no-legend | wc -l)

      stage=none
      marker=none
      if [ "$state" = 1 ]; then
        stage=$(cat ${stateDir}/check-stage 2>/dev/null || echo 0)
        if [ "$stage" = 0 ]; then
          # The strings are joined here, so they reach the disk only when written.
          printf 'OTEHON_%s_%s\n' ENCRYPTED CANARY > ${stateDir}/canary
          cat /proc/sys/kernel/random/uuid >> ${stateDir}/canary
          printf 'OTEHON_%s_%s\n' PLAIN CANARY > /var/lib/otehon-plain-canary
        fi
        marker=$(sha256sum ${stateDir}/canary 2>/dev/null | cut -c1-16 || echo none)
      fi
      echo "OTEHON_BOOT_REPORT id=${config.system.image.id} version=${config.system.image.version} stage=$stage generation=$gen state=$state sops=$sops listeners=$listeners marker=$marker failed=$failed"

      switch() {
        nix-env -p ${profile} "$@" >/dev/null
        [ -e /etc/otehon-check-skip-switch ] || "$(readlink -f ${profile})/bin/switch-to-configuration" boot
      }
      case "$stage" in
        0)
          switch --set "$(readlink -f /run/current-system)"
          switch --set "$(readlink -f /run/current-system/specialisation/update)"
          echo 1 > ${stateDir}/check-stage
          sync
          systemctl reboot --no-block
          ;;
        1)
          switch --rollback
          echo 2 > ${stateDir}/check-stage
          sync
          systemctl reboot --no-block
          ;;
        2)
          echo 3 > ${stateDir}/check-stage
          sync
          # base-check-qemu.sh probes the ports during this wait.
          sleep 30
          systemctl poweroff --no-block
          ;;
      esac
    '';
  };
}
