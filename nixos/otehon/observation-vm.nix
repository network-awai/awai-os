{ modulesPath, ... }:
{
  # Isolated channel qualification image, not a live desktop replacement.
  imports = [ ./common.nix ./node-observation.nix "${modulesPath}/profiles/minimal.nix" ];
  otehon.nodeObservation.enable = true;
  system.image.id = "awai-otehon-observation-candidate";
  system.image.version = "0.1.0";
}
