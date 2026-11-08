{ config, lib, pkgs, ... }:
let
  user = "otehon";
  cfg = config.otehon;

  shell = pkgs.buildNpmPackage {
    pname = "awai-otehon-shell";
    version = config.system.image.version;
    src = lib.cleanSourceWith {
      src = ./shell;
      filter = path: _: !(lib.elem (baseNameOf path) [ "node_modules" "dist" ]);
    };
    env = {
      RELAY_ORIGIN = cfg.relayOrigin;
      OTEHON_E2E = if cfg.e2e then "1" else "0";
    };
    doCheck = true;
    checkPhase = ''
      runHook preCheck
      npm test
      runHook postCheck
    '';
    npmDepsHash = "sha256-+eGDC+FhMI1HZAxJuKmVzPii0nsx/ZottLbE+B4LxVA=";
    installPhase = ''
      runHook preInstall
      cp -r dist $out
      runHook postInstall
    '';
  };

  # The profile stays in the image. The DevTools port is on loopback and is how
  # the boot report reads the page title.
  browser = pkgs.writeShellScript "otehon-browser" ''
    exec ${lib.getExe pkgs.chromium} \
      --ozone-platform=wayland \
      --kiosk \
      --no-first-run \
      --no-default-browser-check \
      --password-store=basic \
      --user-data-dir="$HOME/.local/state/otehon-chromium" \
      --remote-debugging-address=127.0.0.1 \
      --remote-debugging-port=9222 \
      ${lib.escapeShellArgs cfg.browserArgs} \
      "file://${shell}/index.html"
  '';
in
{
  # Awai Otehon local desktop (ADR 0026): a React shell in Chromium on Wayland,
  # with cosmic-comp as the Smithay compositor. niri rejects software EGL, which
  # is all this VM has. Zenoh and Matter listen on loopback only.
  # The user has no password and logs in automatically, so this image is for a
  # local VM only. SSH has no keys until one is approved in Tsunagu
  # (connect.nix), and then admits only murakumo-admin with that key.
  imports = [ ./common.nix ./connect.nix ./inference-lane.nix ];

  options.otehon = {
    relayOrigin = lib.mkOption {
      type = lib.types.str;
      default = "https://relay.awai.network";
      description = "The ciphertext relay for phone approval (ADR 0026 D13).";
    };
    browserArgs = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
    };
    e2e = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Build the sign-in test driver into the shell. Check images only.";
    };
    shell = lib.mkOption {
      type = lib.types.package;
      readOnly = true;
      default = shell;
    };
  };

  config = {
  system.image.id = "awai-otehon-desktop";
  system.image.version = "0.6.0";

  hardware.graphics.enable = true;
  fonts.packages = [ pkgs.noto-fonts-cjk-sans ];
  documentation.nixos.enable = false;

  users.users.${user} = {
    isNormalUser = true;
    hashedPassword = "!";
  };
  services.greetd = {
    enable = true;
    settings = rec {
      initial_session = {
        command = "${lib.getExe pkgs.cosmic-comp} ${browser}";
        inherit user;
      };
      default_session = initial_session;
    };
  };

  services.zenohd = {
    enable = true;
    settings = {
      listen.endpoints = [ "tcp/127.0.0.1:7447" ];
      scouting.multicast.enabled = false;
      plugins.rest.http_port = "127.0.0.1:8000";
    };
  };

  services.matter-server = {
    enable = true;
    extraArgs.listen-address = "127.0.0.1";
  };

  systemd.services.otehon-boot-report = {
    wantedBy = lib.mkForce [ "graphical.target" ];
    after = lib.mkForce [ "graphical.target" ];
    path = [ pkgs.curl pkgs.gnugrep pkgs.procps ];
    script = ''
      title=""
      for _ in $(seq 1 120); do
        title=$(curl -s --max-time 2 http://127.0.0.1:9222/json | grep -o '"title": "Awai Otehon [^"]*"' || true)
        case "$title" in *"zenoh=1 matter=1"*) break ;; esac
        sleep 2
      done
      sleep 5
      compositor=0; pgrep -u ${user} -x cosmic-comp >/dev/null && compositor=1
      chromium=0; pgrep -u ${user} -f chromium >/dev/null && chromium=1
      react=0; zenoh=0; matter=0
      [ -n "$title" ] && react=1
      case "$title" in *zenoh=1*) zenoh=1 ;; esac
      case "$title" in *matter=1*) matter=1 ;; esac
      # The apps stay hidden until sign-in, so a fresh boot must show the gate.
      gate=0
      case "$title" in *"gate=1 dapps=0\""*) gate=1 ;; esac
      failed=$(systemctl list-units --state=failed --no-legend | wc -l)
      case "$title" in
        *"zenoh=1 matter=1"*) ;;
        *)
          ls -la /dev/dri || true
          journalctl -b --no-pager -o cat -n 80 _UID=$(id -u ${user}) || true
          journalctl -b --no-pager -o cat -n 20 -u matter-server -u zenohd || true
          ;;
      esac
      echo "OTEHON_BOOT_REPORT id=${config.system.image.id} version=${config.system.image.version} nixos=${config.system.nixos.version} compositor=$compositor chromium=$chromium react=$react zenoh=$zenoh matter=$matter gate=$gate failed=$failed"
    '';
  };

  image.repart.partitions = {
    esp.repartConfig.SizeMinBytes = "256M";
    root.repartConfig = {
      SizeMinBytes = "12G";
      SizeMaxBytes = "12G";
    };
  };
  };
}
