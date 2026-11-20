{ nixpkgsPath }:
let
  evaluate = enabled: import (nixpkgsPath + "/nixos") {
    system = "x86_64-linux";
    configuration = {
      imports = [ ../native-workspace.nix ];
      networking.hostName = "murakumo-test";
      services.murakumoNative = { enable = enabled; desktop = enabled; scope = "nixos-vm"; };
    };
  };
  disabled = (evaluate false).config;
  enabled = (evaluate true).config;
  monitor = enabled.systemd.services.murakumo-node-monitor;
  listen = enabled.services.nginx.virtualHosts.murakumo-workspace.listen;
in
assert !builtins.hasAttr "murakumo-node-monitor" disabled.systemd.services;
assert !builtins.hasAttr "murakumo-account-link" enabled.systemd.services;
assert !builtins.hasAttr "murakumo-provider" enabled.systemd.services;
assert monitor.serviceConfig.User == "murakumo-monitor";
assert monitor.serviceConfig.Restart == "always";
assert monitor.environment.KEXE_ALLOW == "7,35,38,39";
assert builtins.length listen == 1;
assert (builtins.head listen).addr == "127.0.0.1" && (builtins.head listen).port == 18780;
assert enabled.services.cage.user == "murakumo";
assert enabled.fonts.fontconfig.enable;
assert builtins.elem "nginx.service" enabled.systemd.services.cage-tty1.requires;
{
  disabledByDefault = true;
  nativeServiceAndStaticOrigin = true;
  desktopHasFontsAndWaitsForAssets = true;
  legacySetupAndProviderNotImported = true;
  # This is evaluation only; the real KVM gates carry boot/runtime evidence.
}
