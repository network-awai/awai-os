{ config, lib, pkgs, ... }:
let
  fleet = ./bot-fleet;
  classpath = "${fleet}/src:${fleet}/vm/vendor/itonami/otehon/src:${./storage}/src:${./storage}/vendor/apex/src:${./storage}/vendor/apex-car/src";
in {
  imports = [ ./bot-vm.nix ];
  system.image.id = lib.mkForce "awai-meiji-bot-vm";
  system.image.version = lib.mkForce "0.2.0-AWAI-2820";
  # Avoid loop-device probing that succeeds before a forbidden namespace mount.
  # Offline construction uses the pinned filesystem tools without mounting.
  system.build.image = lib.mkForce (config.image.repart.image.overrideAttrs (old: {
    systemdRepartFlags = old.systemdRepartFlags ++ [ "--offline=yes" ];
  }));
  # The old history disk has otehon-root too; avoid an ambiguous root device.
  image.repart.partitions.root.repartConfig.Label = lib.mkForce "meiji-root";
  fileSystems."/".device = lib.mkForce "/dev/disk/by-partlabel/meiji-root";
  services.openssh.authorizedKeysFiles = lib.mkForce [ "/run/itonami-vm-keys/operator_authorized_keys" ];
  systemd.services.meiji-history = {
    description = "Verify and import preserved Bot results from read-only history";
    wantedBy = [ "multi-user.target" ];
    before = [ "itonami-vm-keys.service" ];
    after = [ "systemd-udev-settle.service" ];
    wants = [ "systemd-udev-settle.service" ];
    serviceConfig = { Type = "oneshot"; RemainAfterExit = true; };
    path = [ pkgs.coreutils pkgs.util-linux ];
    script = ''
      set -eu
      # A restart must preserve newer work rather than import the old disk again.
      if [ ! -f /var/lib/itonami-bot-vm/meiji-history.edn ]; then
        history=/dev/disk/by-id/virtio-itonami-vm-history-part2
        test -b "$history"
        test "$(blockdev --getro "$history")" = 1
        mkdir -p /run/meiji-history
        mount -t ext4 -o ro,noload "$history" /run/meiji-history
        trap 'umount /run/meiji-history' EXIT
      fi
      ${pkgs.babashka}/bin/bb --classpath '${classpath}' -m bot-fleet.meiji-history
    '';
  };
  systemd.services.itonami-vm-keys = {
    requires = [ "meiji-history.service" ];
    after = [ "meiji-history.service" ];
  };
}
