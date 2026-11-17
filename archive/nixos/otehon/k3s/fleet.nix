# Apply inside existing Otehon guests, not to their macOS hosts. Addresses must
# come from verified guest routing; host Tailscale/LAN addresses are not defaults.
{ node, addresses, interface, tokenFile, managementAddresses ? [ ] }:
{ lib, ... }:
let
  names = [ "jacob" "dan" "judah" ];
  valid = lib.elem node names && lib.all (name: builtins.hasAttr name addresses) names;
in {
  imports = [ ./default.nix ];
  assertions = [
    { assertion = valid; message = "Otehon K3s fleet requires jacob, dan and judah guest addresses."; }
    { assertion = builtins.length (lib.unique (builtins.attrValues addresses)) == builtins.length (builtins.attrNames addresses);
      message = "Otehon K3s guest addresses must be distinct."; }
  ];
  networking.hostName = lib.mkForce "awai-${node}";
  otehon.k3s = {
    role = if node == "jacob" then "server" else "agent";
    nodeName = node;
    nodeAddress = addresses.${node} or "";
    peerAddresses = map (name: addresses.${name} or "") names;
    inherit interface tokenFile managementAddresses;
    serverAddress = if node == "jacob" then "" else "https://${addresses.jacob or ""}:6443";
  };
}
