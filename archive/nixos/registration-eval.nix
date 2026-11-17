# Evaluation fixture only; no install, activation, identity or account mutation.
{ ... }:
{
  imports = [ ./node-base.nix ];
  services.murakumoAccountLink.enable = true;
  system.stateVersion = "26.05";
}
