{ config, lib, pkgs, ... }:
let
  cfg = config.services.murakumoProvider;
  inherit (lib) mkEnableOption mkIf mkOption types;
  start = pkgs.writeShellScript "murakumo-provider-start" ''
    set -eu
    export MURAKUMO_NODE_IDENTITY_FILE="$CREDENTIALS_DIRECTORY/device-identity.json"
    exec ${lib.escapeShellArg cfg.executable} node join \
      --name ${lib.escapeShellArg cfg.name} \
      --model ${lib.escapeShellArg cfg.model} \
      --local-url ${lib.escapeShellArg cfg.localUrl} \
      ${lib.optionalString cfg.idleOnly "--idle-only"}
  '';
in
{
  options.services.murakumoProvider = {
    enable = mkEnableOption "opt-in Murakumo Community inference provider";
    executable = mkOption {
      type = types.str;
      default = "/opt/murakumo-bin/murakumo";
      description = "Absolute path to the verified Murakumo CLI launcher.";
    };
    identityFile = mkOption {
      type = types.str;
      default = "/var/lib/murakumo/device-identity.json";
      description = "Absolute path to the private, factory-provisioned Ed25519 device identity.";
    };
    name = mkOption {
      type = types.str;
      default = config.networking.hostName;
      description = "Public name advertised for this node.";
    };
    model = mkOption {
      type = types.str;
      default = "";
      description = "Exact model ID returned by the local /v1/models endpoint.";
    };
    localUrl = mkOption {
      type = types.str;
      default = "http://127.0.0.1:11434/v1";
      description = "Loopback OpenAI-compatible model server endpoint.";
    };
    idleOnly = mkOption {
      type = types.bool;
      default = true;
      description = "Advertise zero free slots while CPU load or free memory makes the host busy.";
    };
  };

  config = mkIf cfg.enable {
    assertions = [
      { assertion = lib.hasPrefix "/" cfg.executable;
        message = "services.murakumoProvider.executable must be an absolute path."; }
      { assertion = lib.hasPrefix "/" cfg.identityFile;
        message = "services.murakumoProvider.identityFile must be an absolute path."; }
      { assertion = cfg.model != "";
        message = "services.murakumoProvider.model must match a locally served model ID."; }
      { assertion = lib.hasPrefix "http://127.0.0.1:" cfg.localUrl
                 || lib.hasPrefix "http://[::1]:" cfg.localUrl;
        message = "services.murakumoProvider.localUrl must use a loopback model server."; }
    ];

    systemd.services.murakumo-provider = {
      description = "Opt-in Murakumo idle inference provider";
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ];
      path = [ pkgs.nodejs_22 ];
      unitConfig.ConditionPathExists = cfg.identityFile;
      serviceConfig = {
        Type = "simple";
        ExecStart = start;
        Restart = "on-failure";
        RestartSec = 30;
        DynamicUser = true;
        LoadCredential = [ "device-identity.json:${cfg.identityFile}" ];
        ProtectHome = true;
        ProtectSystem = "strict";
        PrivateTmp = true;
        NoNewPrivileges = true;
        UMask = "0077";
      };
    };
  };
}
