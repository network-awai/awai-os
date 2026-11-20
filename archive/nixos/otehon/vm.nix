{ modulesPath, ... }:
{
  # Awai Otehon first VM (ADR 0026). No network service, no login and no keys:
  # it only proves that the pinned NixOS system boots and reports its state.
  imports = [
    ./common.nix
    "${modulesPath}/profiles/minimal.nix"
  ];

  system.image.id = "awai-otehon-vm";
  system.image.version = "0.1.0";
}
