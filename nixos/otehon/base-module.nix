{ config, lib, pkgs, ... }:
let
  statePart = "otehon-state";
  stateDir = "/var/lib/otehon";
  keyDisk = "/dev/disk/by-id/virtio-otehon-key";
  efiArch = config.nixpkgs.hostPlatform.efiArch;
  closure = pkgs.closureInfo { rootPaths = [ config.system.build.toplevel ]; };
  sops-nix = builtins.fetchTarball {
    url = "https://github.com/Mic92/sops-nix/archive/89a234ce2daf6e568a7d4b4fe250afdd23d84e20.tar.gz";
    sha256 = "05wfngv0x0q219m87m6y97lgfscaa3pjqmxixb11fni3sc33hlb6";
  };
in
{
  # The first implementation stage of AIUEOS Otehon (docs/aiueos-otehon.md in
  # network-awai-apex): encrypted state, secrets, a closed firewall, and boot
  # generations that can be rolled back. Later profiles build on this module.
  # The root partition holds only the public system closure. Private data
  # belongs in the encrypted state volume.
  imports = [
    ./common.nix
    "${sops-nix}/modules/sops"
  ];

  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = false;
  fileSystems."/boot" = {
    device = "/dev/disk/by-partlabel/otehon-esp";
    fsType = "vfat";
    options = [ "umask=0077" ];
  };

  networking.nftables.enable = true;
  networking.firewall.enable = true;

  # The image holds the store without a Nix database, which rollback needs.
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

  # The volume is formatted on first boot, so each node gets its own volume key.
  # With a missing or wrong key disk the unit fails and the volume stays closed.
  systemd.services.otehon-state = {
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
    script = ''
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
      chmod 700 ${stateDir}
      if [ ! -e ${stateDir}/age.key ]; then
        install -m 400 "$keys/age.key" ${stateDir}/age.key
      fi
    '';
  };

  sops = {
    useSystemdActivation = true;
    age.keyFile = "${stateDir}/age.key";
    age.sshKeyPaths = [ ];
    gnupg.sshKeyPaths = [ ];
  };
  systemd.services.sops-install-secrets = {
    after = [ "otehon-state.service" ];
    requires = [ "otehon-state.service" ];
  };

  image.repart.partitions = {
    esp.repartConfig = {
      Label = "otehon-esp";
      SizeMinBytes = "512M";
    };
    # bootctl looks here before it lets the system write boot entries.
    esp.contents."/EFI/systemd/systemd-boot${efiArch}.efi".source =
      "${pkgs.systemd}/lib/systemd/boot/efi/systemd-boot${efiArch}.efi";
    root.contents."/nix-path-registration".source = "${closure}/registration";
    root.repartConfig = {
      SizeMinBytes = "4G";
      SizeMaxBytes = "4G";
    };
    state.repartConfig = {
      Type = "linux-generic";
      Label = statePart;
      SizeMinBytes = "256M";
      SizeMaxBytes = "256M";
    };
  };
}
