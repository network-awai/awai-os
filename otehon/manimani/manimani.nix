{ config, lib, pkgs, ... }:
let
  cfg = config.otehon.manimani;
  llmPort = 8772;
  agents = pkgs.writeText "manimani-agents.json" (builtins.toJSON cfg.agents);
  # Qwen2.5 1.5B Instruct, Apache-2.0. A starting point for a small machine, not a final choice.
  defaultModel = pkgs.fetchurl {
    url = "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf";
    sha256 = "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e";
  };
  # Prompts cannot leave this machine, whatever the code does.
  confined = {
    DynamicUser = true;
    IPAddressDeny = "any";
    IPAddressAllow = "localhost";
    ProtectSystem = "strict";
    ProtectHome = true;
    PrivateTmp = true;
    NoNewPrivileges = true;
    RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_UNIX" ];
    Restart = "always";
    RestartSec = 5;
  };
in
{
  options.otehon.manimani = {
    model = lib.mkOption {
      type = lib.types.path;
      default = defaultModel;
      description = "The GGUF model Manimani runs on.";
    };
    agents = lib.mkOption {
      type = lib.types.listOf (lib.types.submodule {
        options = {
          id = lib.mkOption { type = lib.types.str; };
          name = lib.mkOption { type = lib.types.str; };
          about = lib.mkOption { type = lib.types.str; };
          url = lib.mkOption {
            type = lib.types.str;
            description = "An OpenAI-compatible chat URL on loopback. The service refuses any other.";
          };
          approval = lib.mkOption {
            type = lib.types.enum [ "ask" "auto" ];
            default = "ask";
          };
        };
      });
      default = [ ];
      description = "The agents Manimani may hand work to.";
    };
  };

  config = {
    systemd.services.otehon-manimani-llm = {
      description = "Local model for Manimani";
      wantedBy = [ "multi-user.target" ];
      serviceConfig = confined // {
        ExecStart = lib.concatStringsSep " " [
          (lib.getExe' (pkgs.llama-cpp.override { vulkanSupport = true; }) "llama-server")
          "--host 127.0.0.1"
          "--port ${toString llmPort}"
          "--jinja"
          "--no-webui"
          "-c 8192"
          "-m ${cfg.model}"
        ];
        # The GPU render node, and nothing else from /dev.
        PrivateDevices = false;
        DevicePolicy = "closed";
        DeviceAllow = [ "char-drm rw" ];
        SupplementaryGroups = [ "render" "video" ];
      };
    };

    systemd.services.otehon-manimani = {
      description = "Manimani, the resident bot";
      wantedBy = [ "multi-user.target" ];
      after = [ "otehon-manimani-llm.service" ];
      environment = {
        MANIMANI_LLM = "http://127.0.0.1:${toString llmPort}";
        MANIMANI_STATE = "/var/lib/otehon-manimani/state.edn";
        MANIMANI_AGENTS = toString agents;
      };
      serviceConfig = confined // {
        ExecStart = "${lib.getExe pkgs.babashka} -cp ${./src} -m manimani.service";
        StateDirectory = "otehon-manimani";
        PrivateDevices = true;
      };
    };
  };
}
