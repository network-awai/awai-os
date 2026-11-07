{ ... }:
{
  # Update version 2 in the desktop update check: a healthy desktop.
  imports = [ ./desktop-update-check.nix ];
  environment.etc."otehon-generation".text = "b";
}
