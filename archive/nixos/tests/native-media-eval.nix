{ nixpkgsPath }:
let
  config = (import (nixpkgsPath + "/nixos") {
    system = "x86_64-linux";
    configuration = ../native-iso.nix;
  }).config;
in
assert config.services.murakumoNative.liveSession;
assert !config.services.murakumoNative.networkUpdates.enable;
assert !builtins.hasAttr "murakumo-os-update-guard" config.systemd.timers;
assert !builtins.hasAttr "murakumo-install" config.systemd.services;
assert !builtins.hasAttr "murakumo/os-update.json" config.environment.etc;
assert builtins.hasAttr "murakumo/native-profile" config.environment.etc;
assert builtins.hasAttr "murakumo/network-update-guide.md" config.environment.etc;
{
  liveUpdatesDisabled = true;
  automaticDiskInstallationAbsent = true;
  installedProfileAndGuideIncluded = true;
  # Real ISO boot and operator CLI checks are separate runtime evidence.
}
