{ ... }:
{
  # Negative control for base-check-qemu.sh: port 8444 must be reported reachable.
  imports = [ ./base.nix ];

  networking.firewall.allowedTCPPorts = [ 8444 ];
}
