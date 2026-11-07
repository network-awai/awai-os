{ lib, ... }:
{
  # Check image for hermes.nix: signs in as desktop-login does, then talks to Hermes through the
  # real shell. It has a scripted stand-in for the model, which the driver swaps in for the tool
  # checks. It is not a release.
  imports = [ ./desktop-login.nix ./hermes.nix ];

  system.image.id = lib.mkOverride 40 "awai-otehon-desktop-hermes";

  otehon.agent.testDouble = true;

  systemd.services.otehon-login-e2e = {
    environment.OTEHON_AGENT = "1";
    # An answer from a CPU model can take minutes.
    serviceConfig.TimeoutStartSec = "infinity";
  };

  image.repart.partitions.root.repartConfig = {
    SizeMinBytes = lib.mkForce "16G";
    SizeMaxBytes = lib.mkForce "16G";
  };
}
