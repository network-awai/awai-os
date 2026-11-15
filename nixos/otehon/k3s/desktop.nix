# Build candidate only: importing this never updates a running guest.
args@{ node, addresses, interface, tokenFile, managementAddresses ? [ ] }:
{ lib, ... }: {
  imports = [ ../desktop.nix ../base-module.nix (import ./fleet.nix args) ];
  image.repart.partitions = {
    # Resolve desktop/base fixture sizes deliberately for this opt-in profile.
    esp.repartConfig.SizeMinBytes = lib.mkForce "512M";
    root.repartConfig = {
      SizeMinBytes = lib.mkForce "20G";
      SizeMaxBytes = lib.mkForce "20G";
    };
    state.repartConfig = {
      SizeMinBytes = lib.mkForce "16G";
      SizeMaxBytes = lib.mkForce "16G";
    };
  };
}
