{ config, lib, pkgs, ... }:
let
  cfg = config.otehon.agent;
  apiPort = 8642;
  modelPort = 8773;
  home = "/var/lib/otehon-hermes";
  keyDir = "/run/otehon-agent";

  # The commit is pinned, and its flake.lock pins the Hermes nixpkgs, uv2nix and the rest. The
  # default package has optional integrations for hosted services, which this OS must not need.
  hermesRev = "4d04303818b61bf3aa09278af48356315515965b";
  hermes = (builtins.getFlake "github:NousResearch/hermes-agent/${hermesRev}")
    .packages.${pkgs.stdenv.hostPlatform.system}.default.override { extraDependencyGroups = [ ]; };

  # Apache-2.0. Pinned by revision and digest, and in the image, so nothing downloads at run time.
  modelName = "qwen2.5-1.5b-instruct-q4_k_m";
  model = pkgs.fetchurl {
    url = "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/${modelName}.gguf";
    sha256 = "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e";
  };

  # Saifu holds no keys and reads no network, so it is a safe proof of the mcp_servers path.
  basilisp = pkgs.callPackage ../../dapps/saifu/nix/basilisp.nix { };
  saifu = pkgs.runCommand "otehon-saifu-mcp" { } ''
    mkdir -p $out
    cp -r ${../../dapps/saifu/src} $out/src
    cp -r ${../../dapps/saifu/mcp} $out/mcp
  '';
  saifuMcp = pkgs.writeShellScript "saifu-mcp" ''
    export PYTHONPATH=${saifu}/src
    export PYTHONDONTWRITEBYTECODE=1
    export BASILISP_DO_NOT_CACHE_NAMESPACES=true
    exec ${pkgs.python3.withPackages (_: [ basilisp ])}/bin/basilisp run ${saifu}/mcp/server.lpy
  '';

  settings = (pkgs.formats.yaml { }).generate "hermes-config.yaml" {
    model = {
      provider = "custom";
      base_url = "http://127.0.0.1:${toString modelPort}/v1";
      default = modelName;
      api_key = "local";
      context_length = 64000;
    };
    # No other provider to fall back to: inference is this machine or an error.
    fallback_providers = [ ];
    # An explicit list is authoritative in Hermes: anything not named here is off.
    platform_toolsets.api_server = cfg.toolsets;
    mcp_servers.saifu = {
      command = "${saifuMcp}";
      args = [ ];
      connect_timeout = 180;
    };
    agent.max_turns = 6;
    memory = {
      memory_enabled = false;
      user_profile_enabled = false;
    };
    compression.enabled = false;
    # A small model does better with the tools in front of it than behind a search bridge, and
    # a bridge is one more way to reach a tool.
    tools.tool_search.enabled = "off";
    # A title is one more request to a slow model, for a list this OS does not show.
    auxiliary.title_generation.enabled = false;
    terminal = {
      backend = "local";
      cwd = home;
    };
  };

  hardening = {
    # Prompts cannot leave this machine, whatever the code above does.
    IPAddressDeny = "any";
    IPAddressAllow = "localhost";
    ProtectSystem = "strict";
    ProtectHome = true;
    PrivateTmp = true;
    PrivateDevices = true;
    NoNewPrivileges = true;
    RestrictAddressFamilies = [ "AF_INET" "AF_UNIX" ];
    Restart = "on-failure";
  };
in
{
  # The OS agent (ADR 0026 D14): Hermes on loopback, answering from llama.cpp on loopback. The
  # shell is the only client, and it holds a key made at boot. See docs/otehon/hermes-0.1.0.md.
  options.otehon.agent = {
    toolsets = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ "saifu" ];
      description = "What the agent can use. The default names one MCP server, and no terminal or file tools.";
    };
    testDouble = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Add a scripted stand-in for the model that the driver can swap in. Check images only.";
    };
  };

  config = {
    users.users.hermes = {
      isSystemUser = true;
      group = "hermes";
      home = home;
    };
    users.groups.hermes = { };

    # The key lives for one boot. key.js is readable by the shell's user and root only, and
    # the browser loads it as a file, so the key is never on a command line.
    systemd.services.otehon-agent-key = {
      description = "Make the key between the shell and the agent";
      wantedBy = [ "multi-user.target" ];
      before = [ "otehon-hermes.service" "greetd.service" "otehon-headless-shell.service" ];
      path = [ pkgs.coreutils ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        RuntimeDirectory = "otehon-agent";
        RuntimeDirectoryMode = "0755";
      };
      script = ''
        umask 077
        key=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
        printf 'API_SERVER_KEY=%s\n' "$key" > ${keyDir}/hermes.env
        printf 'globalThis.__OTEHON_AGENT_KEY = "%s";\n' "$key" > ${keyDir}/key.js
        chgrp ${config.users.users.otehon.group} ${keyDir}/key.js
        chmod 0640 ${keyDir}/key.js
      '';
    };

    systemd.services.otehon-llama = {
      description = "Local inference for the agent";
      wantedBy = [ "graphical.target" ];
      after = [ "local-fs.target" ];
      serviceConfig = hardening // {
        # Hermes refuses a window under 64000 tokens.
        ExecStart = lib.escapeShellArgs [
          (lib.getExe' pkgs.llama-cpp "llama-server")
          "--model" model
          "--alias" modelName
          "--ctx-size" "64000"
          "--parallel" "1"
          "--jinja"
          "--host" "127.0.0.1"
          "--port" (toString modelPort)
        ];
        DynamicUser = true;
      };
    };

    systemd.services.otehon-hermes = {
      description = "Hermes Agent, for the shell";
      wantedBy = [ "graphical.target" ];
      after = [ "otehon-agent-key.service" "otehon-llama.service" ];
      requires = [ "otehon-agent-key.service" ];
      environment = {
        HOME = home;
        HERMES_HOME = "${home}/.hermes";
        API_SERVER_ENABLED = "true";
        API_SERVER_HOST = "127.0.0.1";
        API_SERVER_PORT = toString apiPort;
        # The shell is a file:// page, which browsers send as the origin "null".
        API_SERVER_CORS_ORIGINS = "null";
      };
      preStart = ''
        mkdir -p ${home}/.hermes
        install -m 0640 ${settings} ${home}/.hermes/config.yaml
      '';
      serviceConfig = hardening // {
        ExecStart = "${lib.getExe' hermes "hermes"} gateway run";
        EnvironmentFile = "${keyDir}/hermes.env";
        User = "hermes";
        Group = "hermes";
        StateDirectory = "otehon-hermes";
      };
    };

    systemd.services.otehon-model-double = lib.mkIf cfg.testDouble {
      description = "TEST DOUBLE for the model. Never in a release";
      conflicts = [ "otehon-llama.service" ];
      environment.OTEHON_DOUBLE_PORT = toString modelPort;
      serviceConfig = hardening // {
        ExecStart = "${lib.getExe pkgs.python3} ${./hermes-test-double.py}";
        DynamicUser = true;
        RuntimeDirectory = "otehon-model-double";
      };
    };
  };
}
