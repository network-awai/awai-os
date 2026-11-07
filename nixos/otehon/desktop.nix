{ config, lib, pkgs, ... }:
let
  user = "otehon";
  cfg = config.otehon;
  # The user's data lives on the encrypted state volume (state.nix), never on the root partition.
  userState = cfg.userState;

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
      IDLE_LOCK_MS = toString (cfg.idleLockSeconds * 1000);
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

  # The profile, cache and config are on the encrypted volume. The DevTools port is on
  # loopback and is how the boot report reads the page title.
  browser = pkgs.writeShellScript "otehon-browser" ''
    export XDG_CONFIG_HOME=${userState}/config XDG_CACHE_HOME=${userState}/cache XDG_DATA_HOME=${userState}/data
    exec ${lib.getExe pkgs.chromium} \
      ${if cfg.headless then "--headless=new --disable-gpu --window-size=1280,800" else "--ozone-platform=wayland --kiosk"} \
      --no-first-run \
      --no-default-browser-check \
      --password-store=basic \
      --user-data-dir=${userState}/chromium \
      --disk-cache-dir=${userState}/cache/chromium \
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
  imports = [ ./common.nix ./state.nix ./media.nix ./manimani/manimani.nix ];

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
    userState = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/otehon/users/${user}";
      description = "The desktop user's browser profile, cache and config. Inside the encrypted volume.";
    };
    idleLockSeconds = lib.mkOption {
      type = lib.types.ints.positive;
      default = 300;
      description = "The shell locks itself after this long with no input.";
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

  # Data protection (docs/otehon/protection-0.1.0.md). Nothing that holds the user's data
  # starts unless the volume is open, so a closed volume means no desktop, not a desktop
  # that writes to the plain root partition.
  otehon.state = {
    mode = "711";
    binds = [
      # The journal: logs reach the disk only inside the volume. Before the volume opens
      # they stay in memory (/run/log/journal).
      { source = "journal"; target = "/var/log/journal"; mode = "2755"; group = "systemd-journal"; }
      # StateDirectory of DynamicUser services, such as generated media and Manimani's state.
      { source = "private"; target = "/var/lib/private"; }
    ];
    requiredBy = [
      "systemd-journal-flush"
      "otehon-user-state"
      "otehon-media"
      "otehon-manimani"
    ] ++ (if cfg.headless then [ "otehon-headless-shell" ] else [ "greetd" ]);
  };
  systemd.services.otehon-user-state = {
    description = "Create the desktop user's directory on the encrypted volume";
    wantedBy = [ "multi-user.target" ];
    before = [ "greetd.service" "otehon-headless-shell.service" ];
    requiredBy = if cfg.headless then [ "otehon-headless-shell.service" ] else [ "greetd.service" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    script = ''
      install -d -m 711 "$(dirname ${userState})"
      install -d -m 700 -o ${user} -g users ${userState}
      for dir in chromium cache config data; do
        install -d -m 700 -o ${user} -g users ${userState}/$dir
      done
    '';
  };
  # Chromium writes temporary files to /tmp. Keep them in memory.
  boot.tmp.useTmpfs = true;
  systemd.coredump.settings.Coredump.Storage = "none";
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
    state.repartConfig = {
      SizeMinBytes = "1G";
      SizeMaxBytes = "1G";
    };
    root.repartConfig = {
      SizeMinBytes = "12G";
      SizeMaxBytes = "12G";
    };
  };
  };
}
