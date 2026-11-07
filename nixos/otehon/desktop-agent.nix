{ lib, ... }:
{
  # The desktop with the agent. Hermes and its model are separate from desktop.nix for now, so
  # that the images without them stay small and do not need flakes to evaluate.
  imports = [ ./desktop.nix ./hermes.nix ];

  image.repart.partitions.root.repartConfig = {
    SizeMinBytes = lib.mkForce "16G";
    SizeMaxBytes = lib.mkForce "16G";
  };
}
