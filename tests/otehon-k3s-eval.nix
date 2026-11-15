{ nixpkgsPath }:
let
  lib = import (nixpkgsPath + "/lib");
  addresses = { jacob = "192.168.1.1"; dan = "192.168.1.2"; judah = "192.168.1.3"; };
  args = node: { inherit node addresses; interface = "eth1"; tokenFile = "/run/secrets/otehon-k3s-token"; };
  eval = modules: (import (nixpkgsPath + "/nixos/lib/eval-config.nix") {
    system = "x86_64-linux";
    modules = [ ../nixos/otehon/k3s/default.nix {
      system.stateVersion = "26.05";
      fileSystems."/" = { device = "/dev/disk/by-label/evaluation-only"; fsType = "ext4"; };
      boot.loader.grub.enable = false;
    } ] ++ modules;
  }).config;
  valid = c: builtins.all (a: a.assertion) c.assertions;
  requireValid = c: lib.assertMsg (valid c)
    (lib.concatMapStringsSep "\n" (a: a.message) (builtins.filter (a: !a.assertion) c.assertions));
  off = eval [ ];
  nodes = lib.genAttrs [ "jacob" "dan" "judah" ] (n: eval [ (import ../nixos/otehon/k3s/fleet.nix (args n)) ]);
  desktop = arch: (import (nixpkgsPath + "/nixos/lib/eval-config.nix") {
    system = null;
    modules = [ (import ../nixos/otehon/k3s/desktop.nix (args "jacob"))
      { nixpkgs.hostPlatform = "${arch}-linux"; } ];
  }).config;
  bad = settings: eval [ (import ../nixos/otehon/k3s/fleet.nix (args "dan"))
    { otehon.k3s = lib.mapAttrs (_: lib.mkForce) settings; } ];
in
assert !(off.systemd.services ? k3s);
assert off.networking.firewall.allowedTCPPorts == [ ];
assert lib.all requireValid (builtins.attrValues nodes);
assert nodes.jacob.services.k3s.role == "server";
assert !nodes.jacob.services.k3s.clusterInit;
assert nodes.dan.services.k3s.role == "agent" && nodes.judah.services.k3s.role == "agent";
assert nodes.dan.services.k3s.serverAddr == "https://192.168.1.1:6443";
assert nodes.jacob.services.k3s.nodeTaint != [ ];
assert lib.elem "otehon-state.service" nodes.jacob.systemd.services.k3s.bindsTo;
assert nodes.jacob.services.k3s.token == "";
assert nodes.jacob.environment.sessionVariables.KUBECONFIG == "/var/lib/otehon/k3s/admin.yaml";
assert nodes.jacob.networking.firewall.allowedTCPPorts == [ ];
assert !(valid (bad { tokenFile = "/nix/store/public-token"; }));
assert !(valid (bad { tokenFile = null; }));
assert !(valid (bad { interface = "lo"; }));
assert !(valid (bad { serverAddress = "http://192.168.1.1:6443"; }));
assert !(valid (bad { podCIDR = "10.43.0.0/16"; }));
assert !(valid (bad { podCIDR = "10.43.1.0/24"; }));
assert !(valid (bad { podCIDR = "192.168.0.0/16"; }));
assert !(valid (bad { nodeAddress = "999.1.1.1"; }));
assert !(valid (bad { tokenFile = "/run/keys/../../nix/store/public-token"; }));
assert !(valid (eval [ (import ../nixos/otehon/k3s/fleet.nix
  ((args "dan") // { addresses = addresses // { judah = addresses.dan; }; })) ]));
assert lib.all (arch: requireValid (desktop arch)) [ "aarch64" "x86_64" ];
assert (desktop "aarch64").services.greetd.enable;
assert (desktop "aarch64").image.repart.partitions.state.repartConfig.SizeMinBytes == "16G";
{
  disabledHasNoService = true;
  serverAndTwoAgents = true;
  desktopBothArchitectures = true;
  encryptedStateDependency = true;
  negativeConfigurationsRefused = true;
  noGlobalFirewallOpening = true;
}
