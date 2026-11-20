{ config, lib, pkgs, ... }:
let
  cfg = config.services.murakumoClaimResponder;
  inherit (lib) mkEnableOption mkIf mkOption types;
  respond = pkgs.writeShellScript "murakumo-claim-once" ''
    set -eu
    export MURAKUMO_NODE_IDENTITY_FILE="$CREDENTIALS_DIRECTORY/device-identity.json"
    exec ${lib.escapeShellArg cfg.executable} node claim-once
  '';
in
{
  options.services.murakumoClaimResponder = {
    enable = mkEnableOption "factory-provisioned Murakumo device claim responder";
    executable = mkOption {
      type = types.str;
      default = "/opt/murakumo-bin/murakumo";
      description = "Absolute path to the verified Murakumo CLI launcher.";
    };
    identityFile = mkOption {
      type = types.str;
      default = "/var/lib/murakumo/device-identity.json";
      description = "Absolute path to the factory-provisioned Ed25519 identity matching the registered device DID.";
    };
  };

  config = mkIf cfg.enable {
    assertions = [
      { assertion = lib.hasPrefix "/" cfg.executable;
        message = "services.murakumoClaimResponder.executable must be an absolute path."; }
      { assertion = lib.hasPrefix "/" cfg.identityFile;
        message = "services.murakumoClaimResponder.identityFile must be an absolute path."; }
    ];
    systemd.services.murakumo-claim-responder = {
      description = "Answer a pending Murakumo buyer device claim";
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ];
      path = [ pkgs.nodejs_22 ];
      unitConfig.ConditionPathExists = cfg.identityFile;
      serviceConfig = {
        Type = "oneshot";
        ExecStart = respond;
        DynamicUser = true;
        LoadCredential = [ "device-identity.json:${cfg.identityFile}" ];
        ProtectHome = true;
        ProtectSystem = "strict";
        PrivateTmp = true;
        NoNewPrivileges = true;
        UMask = "0077";
      };
    };
    systemd.timers.murakumo-claim-responder = {
      description = "Poll for a pending Murakumo buyer device claim";
      wantedBy = [ "timers.target" ];
      timerConfig = {
        OnBootSec = "30s";
        OnUnitActiveSec = "15s";
        Unit = "murakumo-claim-responder.service";
      };
    };
  };
}
