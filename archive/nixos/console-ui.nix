{ pkgs, lib, ... }:
let
  # Node resolves /etc symlinks to their store paths before relative imports.
  # Keep the local setup module and its identity dependency in one directory.
  localSetup = pkgs.runCommand "murakumo-local-setup" {} ''
    mkdir -p $out
    cp ${./local-setup.mjs} $out/local-setup.mjs
    cp ${./account-link.mjs} $out/account-link.mjs
    cp ${./node-root-receipt.mjs} $out/node-root-receipt.mjs
  '';
  sound = pkgs.runCommand "murakumo-setup-sound" {} ''
    mkdir -p $out
    cp ${./acoustic-code.mjs} $out/acoustic-code.mjs
    cp ${./setup-sound.mjs} $out/setup-sound.mjs
    ${pkgs.nodejs_22}/bin/node $out/setup-sound.mjs ambient $out/startup.wav
  '';
  logo = pkgs.runCommand "murakumo-logo.png" { nativeBuildInputs = [ pkgs.librsvg ]; } ''
    # Preserve the supplied source; only the displayed fill color changes.
    sed 's/fill="#ffffff"/fill="#253b62"/g' ${./murakumo-logo.svg} > logo.svg
    rsvg-convert --width 960 --height 148 --keep-aspect-ratio logo.svg > "$out"
  '';
  graphical = pkgs.stdenvNoCC.mkDerivation {
    pname = "murakumo-setup-ui";
    version = "1";
    dontUnpack = true;
    nativeBuildInputs = [ pkgs.wrapGAppsHook4 pkgs.gobject-introspection ];
    buildInputs = [ pkgs.gtk4 pkgs.gjs pkgs.adwaita-icon-theme ];
    installPhase = ''
      mkdir -p $out/bin
      cp ${./graphical-ui.js} $out/bin/murakumo-setup-ui
      chmod +x $out/bin/murakumo-setup-ui
      substituteInPlace $out/bin/murakumo-setup-ui --replace-fail /usr/bin/env\ gjs ${pkgs.gjs}/bin/gjs
    '';
  };
  graphicalDialog = pkgs.writeShellScriptBin "dialog" ''
    exec ${pkgs.nodejs_22}/bin/node /etc/murakumo/graphical-dialog.mjs "$@"
  '';
  voice = import ./voice-runtime.nix { inherit pkgs; };
in {
  imports = [ ./ble-setup.nix ];
  services.murakumoBle.enable = lib.mkDefault true;
  environment.etc."murakumo/voice-NOTICES.txt".source = ./voice-NOTICES.txt;
  users.groups.murakumo-voice = {};
  users.users.murakumo-voice = { isSystemUser = true; group = "murakumo-voice"; extraGroups = [ "audio" ]; };
  services.seatd.enable = true;
  hardware.alsa.enable = true;
  fonts.packages = [ pkgs.noto-fonts-cjk-sans ];
  fonts.fontconfig.enable = true;
  environment.systemPackages = with pkgs; [ dialog fbterm networkmanager weston qrencode graphical voice ];
  environment.etc."murakumo/voice-runtime.nix".source = ./voice-runtime.nix;
  environment.etc."murakumo/voice-agent.mjs".source = ./voice-agent.mjs;
  environment.etc."murakumo/voice-control.mjs".source = ./voice-control.mjs;
  environment.etc."murakumo/voice-policy.json".source = ./voice-policy.json;
  environment.etc."murakumo/voice-tts.py".source = ./voice-tts.py;
  environment.etc."murakumo/murakumo-logo.svg".source = ./murakumo-logo.svg;
  environment.etc."murakumo/logo.png".source = logo;
  environment.etc."murakumo/acoustic-code.mjs".source = "${sound}/acoustic-code.mjs";
  environment.etc."murakumo/setup-sound.mjs".source = "${sound}/setup-sound.mjs";
  environment.etc."murakumo/startup.wav".source = "${sound}/startup.wav";
  environment.etc."murakumo/sound-link.html".source = ./sound-link.html;
  environment.etc."murakumo/graphical-ui.js".source = ./graphical-ui.js;
  environment.etc."murakumo/graphical-dialog.mjs".source = ./graphical-dialog.mjs;
  environment.etc."murakumo/network-setup.mjs".source = ./network-setup.mjs;
  environment.etc."murakumo/local-setup.mjs".source = "${localSetup}/local-setup.mjs";
  environment.etc."murakumo/language.mjs".source = ./language.mjs;
  environment.etc."murakumo/node-status.mjs".source = ./node-status.mjs;
  environment.etc."murakumo/update-ui.mjs".source = ./update-ui.mjs;
  environment.etc."murakumo/production-update-trust.json".source = ./production-update-trust.json;
  environment.etc."murakumo/setup-ui.mjs".source = ./setup-ui.mjs;
  environment.etc."murakumo/registration-ui.mjs".source = ./registration-ui.mjs;
  environment.etc."murakumo/launch-ui".source = pkgs.writeShellScript "murakumo-console-ui" ''
    export TERM=linux LC_ALL=C.UTF-8
    export PATH=${pkgs.alsa-utils}/bin:${pkgs.nodejs_22}/bin:$PATH
    # Start a single application compositor with software rendering. The
    # backend runs only after its private UI transport is listening.
    session=$(${pkgs.coreutils}/bin/mktemp -d /run/murakumo-ui/session.XXXXXX)
    export MURAKUMO_UI_SESSION="$session" MURAKUMO_UI_LANG=ja
    export LIBSEAT_BACKEND=seatd
    export XDG_RUNTIME_DIR="$session" WAYLAND_DISPLAY=murakumo-wayland
    export MURAKUMO_UI_SOCKET="$session/ui.sock" GDK_BACKEND=wayland GSK_RENDERER=cairo
    mkdir -p /run/murakumo-voice
    # Allow the unprivileged runtime to traverse into its own 0700 session.
    ${pkgs.coreutils}/bin/chmod 0711 /run/murakumo-voice
    export MURAKUMO_VOICE_DIR=$(${pkgs.coreutils}/bin/mktemp -d /run/murakumo-voice/session.XXXXXX)
    export MURAKUMO_VOICE_SOCKET="$session/voice.sock"
    ${voice}/bin/aiueos-voice > "$session/voice-runtime.log" 2>&1 &
    voice_pid=$!
    trap 'kill "$voice_pid" 2>/dev/null || true' EXIT
    for attempt in $(${pkgs.coreutils}/bin/seq 1 100); do
      [ ! -S "$MURAKUMO_VOICE_SOCKET" ] || break
      kill -0 "$voice_pid" 2>/dev/null || break
      ${pkgs.coreutils}/bin/sleep 0.1
    done
    # Wait for input-device classification before Weston enumerates its seat.
    ${pkgs.systemd}/bin/udevadm settle --timeout=30 || true
    ${pkgs.weston}/bin/weston --backend=drm-backend.so --shell=kiosk-shell.so --renderer=pixman --socket="$WAYLAND_DISPLAY" --idle-time=0 --log="$session/weston.log" &
    compositor=$!
    for attempt in $(${pkgs.coreutils}/bin/seq 1 100); do
      [ ! -S "$session/$WAYLAND_DISPLAY" ] || break
      kill -0 "$compositor" 2>/dev/null || break
      ${pkgs.coreutils}/bin/sleep 0.1
    done
    if [ -S "$session/$WAYLAND_DISPLAY" ]; then
      PATH=${graphicalDialog}/bin:$PATH ${graphical}/bin/murakumo-setup-ui "$@" > "$session/frontend.log" 2>&1
    fi
    kill "$compositor" 2>/dev/null || true
    wait "$compositor" 2>/dev/null || true
    ${pkgs.kbd}/bin/chvt 1 || true
    if [ -f "$session/started" ]; then
      # No console fallback after the backend started, even if GTK crashed.
      result=1
      [ ! -f "$session/result" ] || result=$(cat "$session/result")
      exit "$result"
    fi
    kill "$voice_pid" 2>/dev/null || true
    wait "$voice_pid" 2>/dev/null || true
    unset MURAKUMO_UI_SOCKET GDK_BACKEND GSK_RENDERER WAYLAND_DISPLAY XDG_RUNTIME_DIR
    if [ -c /dev/fb0 ]; then
      session=$(${pkgs.coreutils}/bin/mktemp -d /run/murakumo-ui/session.XXXXXX)
      export MURAKUMO_UI_SESSION="$session" MURAKUMO_UI_LANG=ja
      ${pkgs.fbterm}/bin/fbterm --font-names='Noto Sans Mono CJK JP,Noto Sans CJK JP' --font-size=18 --font-width=10 --font-height=24 -- ${pkgs.bash}/bin/bash -c '
        : > "$MURAKUMO_UI_SESSION/started"
        "$@"
        result=$?
        printf "%s" "$result" > "$MURAKUMO_UI_SESSION/result"
        exit "$result"
      ' murakumo-ui "$@"
      # fbterm may return zero even when its child failed. Never rerun an
      # installer that already started, including after a console exit.
      if [ -f "$session/started" ]; then
        result=1
        [ ! -f "$session/result" ] || result=$(cat "$session/result")
        ${pkgs.coreutils}/bin/rm -rf "$session"
        exit "$result"
      fi
      ${pkgs.coreutils}/bin/rm -rf "$session"
    fi
    export MURAKUMO_UI_LANG=en
    exec "$@"
  '';
}
