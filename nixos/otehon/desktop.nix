{ config, lib, pkgs, ... }:
let
  user = "otehon";
  cfg = config.otehon;

  # AWAI-2791: the shell is ClojureScript (shadow-cljs) with Garden
  # stylesheets, so its build runs Nix-pinned JVM Clojure (owner decision
  # 2026-11-11; the repo-wide JVM ban in CI/CD scripts (JUN-290) does not
  # cover this Nix-pinned Otehon build input). The build sandbox has no
  # network, so Maven artifacts come from the cljDeps fixed-output
  # derivation below instead of ~/.m2; build.mjs points Clojure at it
  # through MVN_REPO.
  #
  # UNTESTED 2026-11-11: the migration machine has no Nix toolchain, so the
  # outputHash below and npmDepsHash are placeholders. Fill them where Nix
  # runs: run the image build, copy each "got: sha256-…" from the hash
  # mismatch error, and paste it over the matching TODO.
  cljDeps = pkgs.stdenv.mkDerivation {
    name = "awai-otehon-shell-clj-deps";
    src = builtins.path { path = ./shell/deps.edn; };
    nativeBuildInputs = [ pkgs.clojure ];
    outputHashAlgo = "sha256";
    outputHashMode = "recursive";
    outputHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; # TODO: fill from the mismatch error
    buildPhase = ''
      runHook preBuild
      export HOME="$TMPDIR/home"
      mkdir -p "$HOME" src vendor
      cp "$src" ./deps.edn
      clojure -Sdeps '{:mvn/local-repo "$out"}' -P
      runHook postBuild
    '';
    installPhase = "runHook preInstall; runHook postInstall;";
  };

  shell = cfg.shellPkgs.buildNpmPackage {
    pname = "awai-otehon-shell";
    version = config.system.image.version;
    src = lib.cleanSourceWith {
      src = ./shell;
      filter = path: _: !(lib.elem (baseNameOf path) [ "node_modules" "dist" ]);
    };
    nativeBuildInputs = [ pkgs.clojure ];
    env = {
      RELAY_ORIGIN = cfg.relayOrigin;
      OTEHON_E2E = if cfg.e2e then "1" else "0";
      MVN_REPO = "${cljDeps}";
    };
    doCheck = true;
    checkPhase = ''
      runHook preCheck
      npm test
      runHook postCheck
    '';
    # TODO: refresh for the current package-lock.json (react arrived with the
    # Hiccup migration); run the image build and copy the "got: sha256-…".
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
  imports = [ ./common.nix ./media.nix ./manimani/manimani.nix ./node-observation.nix ];

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
      # 8772 already serves the Manimani LLM in this image.
      OTEHON_STATUS_PORT = "8774";
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

  # Sound setup (AWAI-168): PipeWire runs the audio graph in the desktop
  # user's session, and the shell drives volume and mute through the loopback
  # otehon-sound service below. The last setting is kept in a root-owned
  # state file and restored at boot, so it survives reboots.
  services.pipewire = {
    enable = true;
    alsa.enable = true;
    pulse.enable = false;
  };

  # Japanese input (AWAI-168): fcitx5 with the mozc engine, started with the
  # desktop user's graphical session. Keyboard stays the default group, so
  # ordinary typing is unchanged; the standard trigger switches to mozc.
  # The check VM has no user session, so this is installation-level here:
  # conversion itself needs real key input (hardware or AWAI-199 Appium).
  i18n.inputMethod = {
    enable = true;
    type = "fcitx5";
    fcitx5.addons = with pkgs; [ fcitx5-mozc ];
    fcitx5.settings.inputMethod = {
      "Groups/0" = {
        Name = "Default";
        "Default Layout" = "us";
        DefaultIM = "keyboard-us";
      };
      "Groups/0/Items/0" = {
        Name = "keyboard-us";
        Layout = "";
      };
      "Groups/0/Items/1" = {
        Name = "mozc";
        Layout = "";
      };
    };
  };
  # Screen reader (AWAI-168): Orca with the AT-SPI bus and speechd behind it.
  # The reader starts only when the flag file exists, so boot stays silent;
  # a future Settei toggle will manage the user-writable flag. The check VM
  # has no session, so the e2e step asserts installation and wiring only:
  # actual narration needs a real session and audio output.
  services.orca.enable = true;

  systemd.user.services.orca-reader = {
    description = "Orca screen reader for the desktop session";
    wantedBy = [ "graphical-session.target" ];
    after = [ "graphical-session.target" ];
    unitConfig.ConditionPathExists = "%h/.config/otehon-screen-reader/enabled";
    serviceConfig = {
      ExecStart = "${lib.getExe pkgs.orca} --replace";
      Restart = "on-failure";
    };
  };

  # Display setup (AWAI-168): screen brightness through brightnessctl, with
  # the last setting kept in a root-owned state file and restored at boot,
  # so it survives reboots. The shell shows an honest empty state when no
  # backlight device exists.
  systemd.services.otehon-display = {
    description = "Loopback display setup for the shell (screen brightness)";
    wantedBy = [ "graphical.target" ];
    after = [ "local-fs.target" ];
    environment = {
      OTEHON_DISPLAY_PORT = "8776";
    };
    path = [ pkgs.brightnessctl pkgs.coreutils ];
    serviceConfig = {
      ExecStart = "${lib.getExe pkgs.python3} ${./display-service.py}";
      User = "root";
      StateDirectory = "otehon-display";
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

  systemd.user.services.fcitx5-daemon = {
    description = "Japanese input through fcitx5 and mozc";
    wantedBy = [ "graphical-session.target" ];
    after = [ "graphical-session.target" ];
    serviceConfig = {
      ExecStart = "${lib.getExe pkgs.fcitx5} --disable=x11";
      Restart = "on-failure";
    };
  };

  systemd.services.otehon-sound = {
    description = "Loopback sound setup for the shell (volume and mute)";
    wantedBy = [ "graphical.target" ];
    after = [ "local-fs.target" ];
    environment = {
      OTEHON_SOUND_PORT = "8775";
      OTEHON_SOUND_USER = user;
    };
    path = [ pkgs.wireplumber pkgs.coreutils ];
    serviceConfig = {
      ExecStart = "${lib.getExe pkgs.python3} ${./sound-service.py}";
      User = "root";
      StateDirectory = "otehon-sound";
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
