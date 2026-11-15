{ config, lib, pkgs, ... }:
let cfg = config.otehon.installerNbd;
in {
  options.otehon.installerNbd = {
    enable = lib.mkEnableOption "verified read-only installer ISO over direct LAN NBD";
    sha256 = lib.mkOption { type = lib.types.str; default = ""; };
    bytes = lib.mkOption { type = lib.types.ints.unsigned; default = 0; };
    payloadSha256 = lib.mkOption { type = lib.types.str; default = ""; };
    rawSha256 = lib.mkOption { type = lib.types.str; default = ""; };
    rawBytes = lib.mkOption { type = lib.types.ints.unsigned; default = 0; };
  };
  config = lib.mkIf cfg.enable {
    assertions = [{
      assertion = builtins.match "[0-9a-f]{64}" cfg.sha256 != null && cfg.bytes > 0
        && builtins.match "[0-9a-f]{64}" cfg.payloadSha256 != null
        && builtins.match "[0-9a-f]{64}" cfg.rawSha256 != null && cfg.rawBytes > 0;
      message = "The installer NBD source requires pinned ISO and compressed/raw payload identities.";
    }];
    boot.kernelModules = [ "nbd" ];
    # Exactly one source device. Unconnected default NBD devices otherwise
    # fill the physical disk chooser with sixteen zero-capacity rows.
    boot.extraModprobeConfig = "options nbd nbds_max=1";
    systemd.services.otehon-installer-source = {
      description = "Verify and mount the read-only network installer ISO";
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ];
      after = [ "network-online.target" "systemd-modules-load.service" ];
      before = [ "otehon-install-broker.service" ];
      path = with pkgs; [ nbd util-linux coreutils ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        TimeoutStartSec = 1200;
        StandardOutput = "journal+console";
        StandardError = "journal+console";
      };
      script = ''
        set -euo pipefail
        echo 'AWAI_NBD: connecting read-only installer source; NVMe untouched'
        trap 'echo "AWAI_NBD: source admission failed; NVMe untouched"' ERR
        # Reserved only for this explicit installer profile. Never use a
        # physical disk as the network source or silently choose another one.
        if nbd-client -c /dev/nbd0; then exit 1; else test "$?" = 1; fi
        if mountpoint -q /iso; then exit 1; fi
        nbd-client -R 10.77.0.1 10809 /dev/nbd0
        trap 'echo "AWAI_NBD: source admission failed; NVMe untouched"; if mountpoint -q /iso; then umount /iso; fi; nbd-client -d /dev/nbd0' ERR
        test "$(blockdev --getro /dev/nbd0)" = 1
        test "$(blockdev --getsize64 /dev/nbd0)" = ${lib.escapeShellArg (toString cfg.bytes)}
        echo 'AWAI_NBD: checking full ISO digest'
        actual=$(sha256sum /dev/nbd0)
        test "''${actual%% *}" = ${lib.escapeShellArg cfg.sha256}
        mkdir -p /iso
        mount -t iso9660 -o ro,nodev,nosuid,noexec /dev/nbd0 /iso
        test -f /iso/otehon/image.raw.zst
        test "$(findmnt -n -o FSTYPE --target /iso/otehon/image.raw.zst)" = iso9660
        echo 'AWAI_NBD: verified ISO mounted; starting installer'
        trap - ERR
      '';
      preStop = ''
        umount /iso
        nbd-client -d /dev/nbd0
      '';
    };
    systemd.services.otehon-install-broker = {
      requires = [ "otehon-installer-source.service" ];
      after = [ "otehon-installer-source.service" ];
    };
  };
}
