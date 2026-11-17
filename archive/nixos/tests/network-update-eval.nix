{ nixpkgsPath }:
let
  evaluate = enable: live: (import (nixpkgsPath + "/nixos") {
    system = "x86_64-linux";
    configuration = {
      imports = [ ../murakumo-nixos.nix ];
      services.murakumoNative = { desktop = false; liveSession = live; networkUpdates.enable = enable; };
      boot.loader.systemd-boot.enable = true;
      boot.loader.efi.canTouchEfiVariables = true;
    };
  }).config;
  disabled = evaluate false false;
  enabled = evaluate true false;
  live = evaluate true true;
in
assert !builtins.hasAttr "murakumo-os-update-guard" disabled.systemd.services;
assert enabled.systemd.services.murakumo-os-update-apply.restartIfChanged == false;
assert enabled.systemd.timers.murakumo-os-update-guard.timerConfig.OnBootSec == "10s";
assert !enabled.services.openssh.enable;
assert enabled.users.users.root.openssh.authorizedKeys.keys == [];
assert !enabled.system.autoUpgrade.enable;
assert builtins.any (a: !a.assertion && a.message == "Network updates require an installed native Murakumo NixOS system, never a live ISO.") live.assertions;
{
  disabledByDefault = true;
  noRemoteAccessOrKeysProvisioned = true;
  durableGuardEnabled = true;
  liveMediaRefused = true;
  channelAutoUpgradeDisabled = true;
}
