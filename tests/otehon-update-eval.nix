{ nixpkgsPath }:
let
  evaluate = modules: (import (nixpkgsPath + "/nixos/lib/eval-config.nix") {
    system = "x86_64-linux";
    modules = [ ../nixos/otehon/desktop.nix { nixpkgs.hostPlatform = "x86_64-linux"; } ] ++ modules;
  }).config;
  off = evaluate [];
  on = evaluate [{
    otehon.update = {
      enable = true;
      baseVersion = 1;
      publicKey = ../nixos/otehon/fixtures/update/test-manifest.pub;
      cacheKey = ../nixos/otehon/fixtures/update/test-cache.pub;
      network = { enable = true; feedUrl = "https://updates.invalid/canary"; };
    };
  }];
in
assert !builtins.hasAttr "otehon-update-poll" off.systemd.services;
assert !builtins.hasAttr "otehon-update-health" off.systemd.services;
assert on.systemd.timers.otehon-update-poll.timerConfig.OnUnitInactiveSec == "30min";
assert on.systemd.services.otehon-update-poll.environment.OTEHON_UPDATE_BASE_VERSION == "1";
assert on.systemd.services.otehon-update-poll.environment.OTEHON_UPDATE_PUBLIC_KEY == toString on.otehon.update.publicKey;
assert on.systemd.services.otehon-update-poll.environment.OTEHON_UPDATE_CACHE_KEY == toString on.otehon.update.cacheKey;
assert on.otehon.update.network.automaticReboot == false;
assert !on.services.openssh.enable;
assert !on.system.autoUpgrade.enable;
assert builtins.all (x: x.assertion) on.assertions;
{ desktopOptIn = true; noImplicitRemoteAccess = true; scheduledPolling = true; explicitRebootEnrollment = true; }
