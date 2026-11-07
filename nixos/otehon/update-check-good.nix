{ ... }:
{
  # Update version 2 in the check: a healthy system.
  imports = [ ./update-check.nix ];
  environment.etc."otehon-generation".text = "b";
}
