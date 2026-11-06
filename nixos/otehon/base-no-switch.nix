{ ... }:
{
  # Negative control for base-check-qemu.sh: the boot entry never changes, so the
  # second boot must still report generation a.
  imports = [ ./base.nix ];

  environment.etc."otehon-check-skip-switch".text = "";
}
