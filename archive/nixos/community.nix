{ config, lib, pkgs, ... }:
let
  cfg = config.services.murakumoCommunity;
in
{
  options.services.murakumoCommunity = {
    enable = lib.mkEnableOption "voluntary idle-only Murakumo Community inference";
    cli = lib.mkOption {
      type = lib.types.str;
      default = "";
      example = "/opt/murakumo/bin/murakumo";
      description = "Absolute path to a Murakumo CLI release with --idle-only support.";
    };
    model = lib.mkOption {
      type = lib.types.str;
      default = "";
      description = "Exact model ID reported by the local /v1/models endpoint.";
    };
    localUrl = lib.mkOption {
      type = lib.types.str;
      default = "http://127.0.0.1:11434/v1";
      description = "Loopback OpenAI-compatible model API.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      { assertion = lib.hasPrefix "/" cfg.cli;
        message = "services.murakumoCommunity.cli must be an absolute path to the installed CLI."; }
      { assertion = cfg.model != "";
        message = "services.murakumoCommunity.model must name the tested local model."; }
      { assertion = lib.hasPrefix "http://127.0.0.1:" cfg.localUrl
                 || lib.hasPrefix "http://[::1]:" cfg.localUrl;
        message = "services.murakumoCommunity.localUrl must be a loopback HTTP endpoint."; }
    ];
    systemd.services.murakumo-community = {
      description = "Voluntary idle-only Murakumo Community inference";
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ];
      after = [ "network-online.target" "murakumo-device-claim.service" ];
      unitConfig.ConditionPathExists = "/var/lib/murakumo/device-identity.json";
      environment.MURAKUMO_NODE_IDENTITY_FILE = "/var/lib/murakumo/device-identity.json";
      preStart = ''
        ${pkgs.nodejs_22}/bin/node /etc/murakumo/node-readiness.mjs \
          --model ${lib.escapeShellArg cfg.model} \
          --local-url ${lib.escapeShellArg cfg.localUrl}
      '';
      script = ''
        exec ${lib.escapeShellArg cfg.cli} node join \
          --model ${lib.escapeShellArg cfg.model} \
          --local-url ${lib.escapeShellArg cfg.localUrl} --idle-only
      '';
      serviceConfig = {
        Type = "simple";
        StateDirectory = "murakumo";
        StateDirectoryMode = "0700";
        Restart = "always";
        RestartSec = 30;
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
      };
    };
  };
}
