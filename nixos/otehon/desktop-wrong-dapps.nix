{ ... }:
{
  # Negative control for desktop-check-qemu.sh: the shell renders fewer tiles than
  # this, so the boot report must say dapps=0.
  imports = [ ./desktop.nix ];

  otehon.expectedDapps = 99;
}
