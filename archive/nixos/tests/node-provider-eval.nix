{ nixpkgsPath }:
let
  evaluate = enabled: import (nixpkgsPath + "/nixos") {
    system = "x86_64-linux";
    configuration = {
      imports = [ ../node-base.nix ];
      networking.hostName = "murakumo-test";
      services.murakumoProvider = {
        enable = enabled;
        model = "test-model";
      };
      services.murakumoClaimResponder.enable = enabled;
    };
  };
  disabled = evaluate false;
  enabled = evaluate true;
  unit = enabled.config.systemd.services.murakumo-provider;
  claimUnit = enabled.config.systemd.services.murakumo-claim-responder;
  claimTimer = enabled.config.systemd.timers.murakumo-claim-responder;
in
assert !builtins.hasAttr "murakumo-provider" disabled.config.systemd.services;
assert !builtins.hasAttr "murakumo-claim-responder" disabled.config.systemd.services;
assert !builtins.hasAttr "murakumo-claim-responder" disabled.config.systemd.timers;
assert unit.serviceConfig.DynamicUser == true;
assert unit.serviceConfig.LoadCredential == [ "device-identity.json:/var/lib/murakumo/device-identity.json" ];
assert unit.unitConfig.ConditionPathExists == "/var/lib/murakumo/device-identity.json";
assert unit.wantedBy == [ "multi-user.target" ];
assert claimUnit.serviceConfig.Type == "oneshot";
assert claimUnit.serviceConfig.DynamicUser == true;
assert claimUnit.serviceConfig.LoadCredential == [ "device-identity.json:/var/lib/murakumo/device-identity.json" ];
assert claimUnit.unitConfig.ConditionPathExists == "/var/lib/murakumo/device-identity.json";
assert claimTimer.wantedBy == [ "timers.target" ];
assert claimTimer.timerConfig.Unit == "murakumo-claim-responder.service";
{
  disabledByDefault = true;
  enabledWithPrivateIdentity = true;
  claimResponderTimer = true;
}
