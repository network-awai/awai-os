{ config, lib, pkgs, ... }:
let
  stateDir = "/var/lib/otehon";
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
    ./state.nix
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
  };
}
