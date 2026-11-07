{ config, lib, pkgs, ... }:
let
  cfg = config.otehon.state;
  statePart = "otehon-state";
  stateDir = "/var/lib/otehon";
  keyDisk = "/dev/disk/by-id/virtio-otehon-key";

  # Each bind puts a directory of the volume over a path on the root partition, after the
  # volume opens. When the volume does not open, nothing is bound, and the units in
  # `requiredBy` do not start, so they never write to the plain root partition instead.
  bindScript = lib.concatMapStrings (bind: ''
    install -d -m ${bind.mode} -o ${bind.owner} -g ${bind.group} ${stateDir}/${bind.source}
    install -d -m ${bind.mode} -o ${bind.owner} -g ${bind.group} ${bind.target}
    mount --bind ${stateDir}/${bind.source} ${bind.target}
  '') cfg.binds;
in
{
  # The encrypted Awai Otehon state volume (docs/otehon/base-0.4.0.md), shared by the base
  # check image and the desktop. The volume is formatted on first boot, so each node gets
  # its own volume key. With a missing or wrong key disk the unit fails and the volume stays
  # closed.
  options.otehon.state = {
    mode = lib.mkOption {
      type = lib.types.str;
      default = "700";
      description = "Mode of the volume's root. The desktop needs 711 so its user can reach its own directory.";
    };
    binds = lib.mkOption {
      default = [ ];
      description = "Directories of the volume to bind over paths on the root partition after it opens.";
      type = lib.types.listOf (lib.types.submodule {
        options = {
          source = lib.mkOption { type = lib.types.str; };
          target = lib.mkOption { type = lib.types.str; };
          mode = lib.mkOption { type = lib.types.str; default = "700"; };
          owner = lib.mkOption { type = lib.types.str; default = "root"; };
          group = lib.mkOption { type = lib.types.str; default = "root"; };
        };
      });
    };
    requiredBy = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = "Units that must not start unless the volume is open.";
    };
  };

  config = {
    systemd.services = {
      otehon-state = {
        description = "Unlock the encrypted Awai Otehon state volume";
        wantedBy = [ "sysinit.target" ];
        after = [ "local-fs.target" "systemd-udevd.service" "systemd-udev-trigger.service" ];
        before = [ "sysinit.target" "shutdown.target" ];
        conflicts = [ "shutdown.target" ];
        unitConfig.DefaultDependencies = false;
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          StandardOutput = "journal+console";
          StandardError = "journal+console";
        };
        path = with pkgs; [ coreutils cryptsetup e2fsprogs gnutar systemd util-linux ];
        # Three parts, so the base image keeps the same script when there are no binds.
        script = lib.concatStrings [
          ''
            part=/dev/disk/by-partlabel/${statePart}
            keys=/run/otehon-key
            trap 'rm -rf "$keys"' EXIT
            udevadm settle --timeout=30
            for _ in $(seq 1 15); do
              [ -b "$part" ] && [ -b ${keyDisk} ] && break
              sleep 1
            done
            [ -b "$part" ] || { echo "otehon-state: no state partition"; exit 1; }
            [ -b ${keyDisk} ] || { echo "otehon-state: no key disk"; exit 1; }

            install -d -m 700 "$keys"
            tar -xf ${keyDisk} -C "$keys"

            if ! cryptsetup isLuks "$part"; then
              if [ "$(head -c 1048576 "$part" | tr -d '\000' | wc -c)" != 0 ]; then
                echo "otehon-state: refusing to format a partition that holds data"
                exit 1
              fi
              cryptsetup luksFormat --batch-mode --key-file "$keys/luks.key" "$part"
            fi
            cryptsetup open --key-file "$keys/luks.key" "$part" otehon-state
            if ! blkid -p /dev/mapper/otehon-state >/dev/null; then
              mkfs.ext4 -q /dev/mapper/otehon-state
            fi
            install -d -m 700 ${stateDir}
            mount /dev/mapper/otehon-state ${stateDir}
            chmod ${cfg.mode} ${stateDir}
          ''
          bindScript
          ''
            if [ ! -e ${stateDir}/age.key ]; then
              install -m 400 "$keys/age.key" ${stateDir}/age.key
            fi
          ''
        ];
      };
    } // lib.genAttrs cfg.requiredBy (_: {
      after = [ "otehon-state.service" ];
      requires = [ "otehon-state.service" ];
    });

    image.repart.partitions.state.repartConfig = {
      Type = "linux-generic";
      Label = statePart;
      SizeMinBytes = lib.mkDefault "256M";
      SizeMaxBytes = lib.mkDefault "256M";
    };
  };
}
