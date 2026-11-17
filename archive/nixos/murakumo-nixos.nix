{ lib, ... }: {
  # Native product profile, intentionally separate from node-base.nix's
  # historical Node.js setup/provider/update tools. No legacy fallback.
  imports = [ ./native-workspace.nix ./network-update.nix ];
  networking.hostName = lib.mkDefault "murakumo-nixos";
  networking.networkmanager.enable = lib.mkDefault true;
  services.murakumoNative = { enable = true; desktop = lib.mkDefault true; };
  system.nixos.distroName = "Murakumo NixOS";
  system.nixos.variant_id = "murakumo";
  system.stateVersion = "26.05";
  # Disks, boot loader and approved remote access belong to the target host.
}
