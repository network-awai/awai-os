{ ... }:
{
  imports = [
    ./hardware-configuration.nix # Generated on the target hardware.
    ./node-base.nix
  ];

  networking.hostName = "murakumo-node";
  networking.useDHCP = true;
  # tty1 displays a QR/device code. The phone approves with its Passkey.
  # Local operator administration remains independent of account linking.
  services.murakumoAccountLink.enable = true;
  # This example assumes UEFI. Check the actual boot mode before applying it.
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
  services.openssh.enable = true;
  services.openssh.settings.PasswordAuthentication = false;
  users.users.operator = {
    isNormalUser = true;
    extraGroups = [ "wheel" "video" "render" ];
    openssh.authorizedKeys.keys = [ "REPLACE_WITH_YOUR_SSH_PUBLIC_KEY" ];
  };

  # Choose the tested stable channel and set the release used for the initial
  # install. Review this when moving the configuration to another NixOS release.
  system.stateVersion = "26.05";
}
