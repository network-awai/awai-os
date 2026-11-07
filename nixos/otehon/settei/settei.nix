{ config, lib, pkgs, ... }:
let
  cfg = config.otehon;
  helperUser = "otehon-settei";
  python = lib.getExe pkgs.python3;
  # The helper's source. Building it runs the unit tests, so the image does not build if a
  # refusal stops working (docs/otehon/daily-0.1.0.md).
  source = pkgs.runCommand "awai-otehon-settei" { nativeBuildInputs = [ pkgs.python3 ]; } ''
    mkdir $out
    cp ${./loopback_peer.py} $out/loopback_peer.py
    cp ${./local_service.py} $out/local_service.py
    cp ${./settei_helper.py} $out/settei_helper.py
    cp ${./web_launcher.py} $out/web_launcher.py
    cp ${./test_settei.py} $out/test_settei.py
    cd $out
    python3 -I -W ignore test_settei.py
    rm -rf $out/__pycache__
  '';
in
{
  # Settei (docs/otehon/daily-0.1.0.md): the Settei screen changes the time zone through a small
  # helper. The helper is the only thing polkit lets change the time zone without asking, and it
  # can do nothing else as root.
  options.otehon.settei = {
    port = lib.mkOption {
      type = lib.types.port;
      default = 8774;
      description = "Loopback port of the Settei helper.";
    };
    webPort = lib.mkOption {
      type = lib.types.port;
      default = 8775;
      description = "Loopback port of the web browser launcher, which runs in the desktop session.";
    };
    source = lib.mkOption {
      type = lib.types.package;
      readOnly = true;
      default = source;
    };
  };

  config = {
    # No fixed zone in the configuration, so timedated may write /etc/localtime. It is on the root
    # file system, so the choice stays after a restart. UTC until someone picks a zone.
    time.timeZone = null;

    users.users.${helperUser} = {
      isSystemUser = true;
      group = helperUser;
      description = "Awai Otehon Settei helper";
    };
    users.groups.${helperUser} = { };

    security.polkit.enable = true;
    # Exactly one action, for exactly one user. Everything else still goes through polkit's defaults.
    security.polkit.extraConfig = ''
      polkit.addRule(function(action, subject) {
        if (action.id == "org.freedesktop.timedate1.set-timezone" && subject.user == "${helperUser}") {
          return polkit.Result.YES;
        }
      });
    '';

    systemd.services.otehon-settei = {
      description = "Settei helper: changes the time zone for the desktop user";
      wantedBy = [ "multi-user.target" ];
      after = [ "dbus.service" "polkit.service" ];
      environment = {
        OTEHON_SETTEI_PORT = toString cfg.settei.port;
        OTEHON_DESKTOP_USER = "otehon";
        OTEHON_TIMEDATECTL = "${config.systemd.package}/bin/timedatectl";
      };
      serviceConfig = {
        # -E and -s ignore PYTHON* variables and user site packages. The script's own directory, a
        # store path, stays on sys.path, which is where its modules are.
        ExecStart = "${python} -E -s ${source}/settei_helper.py";
        User = helperUser;
        Group = helperUser;
        IPAddressDeny = "any";
        IPAddressAllow = "localhost";
        RestrictAddressFamilies = [ "AF_INET" "AF_UNIX" ];
        CapabilityBoundingSet = "";
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictSUIDSGID = true;
        LockPersonality = true;
        MemoryDenyWriteExecute = true;
        SystemCallArchitectures = "native";
        UMask = "0077";
        Restart = "on-failure";
      };
    };
  };
}
