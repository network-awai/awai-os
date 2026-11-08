{ config, lib, pkgs, ... }:
let
  user = "otehon";
  cfg = config.otehon;

  shell = cfg.shellPkgs.buildNpmPackage {
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
    npmDepsHash = "sha256-g9JFQRRKKjIgHCyLRvETNKwnmtl1TsJTTEYJUNuvIxY=";
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
      ${if cfg.headless then "--headless=new --disable-gpu --window-size=1280,800" else "--ozone-platform=wayland --kiosk"} \
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
  # local VM only. It has no SSH or keys.
  imports = [ ./common.nix ./media.nix ./manimani/manimani.nix ];

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
    headless = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Run the shell in headless Chromium with no compositor, for a VM with no display. Check images only.";
    };
    e2e = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Build the sign-in test driver into the shell. Check images only.";
    };
    # The shell is static files, so it can come from another architecture's build.
    shellPkgs = lib.mkOption {
      type = lib.types.pkgs;
      default = pkgs;
    };
    shell = lib.mkOption {
      type = lib.types.package;
      readOnly = true;
      default = shell;
    };
  };

  config = {
  system.image.id = "awai-otehon-desktop";
  system.image.version = "0.7.0";

  hardware.graphics.enable = true;
  fonts.packages = [ pkgs.noto-fonts-cjk-sans ];
  documentation.nixos.enable = false;

  users.users.${user} = {
    isNormalUser = true;
    hashedPassword = "!";
  };
  # krunkit's virtio-gpu has no display (the kernel logs "KMS disabled"), so a compositor cannot start there.
  # greetd is what normally makes graphical.target the default.
  systemd.defaultUnit = lib.mkIf cfg.headless "graphical.target";
  systemd.services.otehon-headless-shell = lib.mkIf cfg.headless {
    description = "The shell in headless Chromium";
    wantedBy = [ "graphical.target" ];
    serviceConfig = {
      User = user;
      ExecStart = browser;
      Restart = "on-failure";
    };
  };
  services.greetd = {
    enable = !cfg.headless;
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

  # Loopback system metrics for the shell's node dock (AWAI-231). The shell shows
  # the services without it; live CPU and memory need this endpoint.
  systemd.services.otehon-status = {
    description = "Loopback system metrics for the shell status UI";
    wantedBy = [ "graphical.target" ];
    after = [ "local-fs.target" ];
    environment = {
      OTEHON_STATUS_PORT = "8772";
    };
    serviceConfig = {
      ExecStart = "${lib.getExe pkgs.python3} ${./status-service.py}";
      DynamicUser = true;
      IPAddressDeny = "any";
      IPAddressAllow = "localhost";
      ProtectSystem = "strict";
      ProtectHome = true;
      PrivateTmp = true;
      NoNewPrivileges = true;
      RestrictAddressFamilies = [ "AF_INET" "AF_UNIX" ];
      Restart = "on-failure";
    };
  };

  services.matter-server = {
    enable = true;
    extraArgs.listen-address = "127.0.0.1";
  };

  # Network setup (AWAI-168): NetworkManager owns wired and Wi-Fi, BlueZ owns
  # Bluetooth. The shell drives both through the loopback otehon-net service
  # below, never the raw tools. Profiles persist in root-owned NM keyfiles,
  # so a joined network survives reboots. Radio silence by default.
  networking.networkmanager.enable = true;
  hardware.bluetooth = {
    enable = true;
    powerOnBoot = false;
  };

  # NetworkManager authorizes operations through polkit, but this image has no
  # PolicyKit1 D-Bus activator, so on-demand start never happens and every
  # authorized call hangs. Start polkit at boot instead of relying on activation.
  systemd.services.polkit.wantedBy = [ "multi-user.target" ];

  systemd.services.otehon-net = {
    description = "Loopback network setup for the shell (Wi-Fi and Bluetooth)";
    wantedBy = [ "graphical.target" ];
    after = [ "local-fs.target" "NetworkManager.service" "bluetooth.service" ];
    environment = {
      OTEHON_NET_PORT = "8773";
    };
    path = [ pkgs.networkmanager pkgs.bluez ];
    serviceConfig = {
      ExecStart = "${lib.getExe pkgs.python3} ${./net-service.py}";
      User = "root";
      IPAddressDeny = "any";
      IPAddressAllow = "localhost";
      ProtectSystem = "strict";
      ProtectHome = true;
      PrivateTmp = true;
      NoNewPrivileges = true;
      RestrictAddressFamilies = [ "AF_INET" "AF_UNIX" "AF_NETLINK" ];
      Restart = "on-failure";
    };
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
