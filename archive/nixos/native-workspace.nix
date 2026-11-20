{ config, lib, pkgs, ... }:
let
  cfg = config.services.murakumoNative;
  package = import ./native-package.nix { inherit pkgs; liveSession = cfg.liveSession; };
in {
  options.services.murakumoNative = {
    enable = lib.mkEnableOption "Murakumo NixOS native host and local Itonami workspace";
    package = lib.mkOption { type = lib.types.package; default = package; description = "Digest-pinned Amu native monitor and static browser app bundle."; };
    hostLabel = lib.mkOption { type = lib.types.str; default = config.networking.hostName; description = "Local display label; not a DID or network admission."; };
    scope = lib.mkOption { type = lib.types.enum [ "nixos-vm" "nixos-host" ]; default = "nixos-host"; };
    desktop = lib.mkEnableOption "local Cage/Chromium Itonami app session";
    liveSession = lib.mkOption { type = lib.types.bool; default = false; description = "Mark temporary live media so the UI requires an export before shutdown."; };
  };
  config = lib.mkIf cfg.enable {
    assertions = [
      { assertion = pkgs.stdenv.hostPlatform.system == "x86_64-linux"; message = "Murakumo NixOS native workspace currently qualifies x86_64-linux only."; }
      { assertion = builtins.match "[a-z0-9-]{1,64}" cfg.hostLabel != null; message = "Murakumo hostLabel must be 1..64 lowercase ASCII letters, digits or hyphens."; }
    ];
    users.groups.murakumo-observe = {};
    users.users.murakumo-monitor = { isSystemUser = true; group = "murakumo-observe"; };
    systemd.services.murakumo-node-monitor = {
      description = "Murakumo native local host observation (not network admission)";
      wantedBy = [ "multi-user.target" ];
      environment = { KEXE_ALLOW = "7,35,38,39"; KEXE_CAP_RESOURCES_35 = "/var/lib/murakumo-observe:/proc"; };
      serviceConfig = {
        User = "murakumo-monitor";
        Group = "murakumo-observe";
        ExecStart = "${cfg.package}/bin/murakumo-node-monitor ${lib.escapeShellArg cfg.hostLabel} $INVOCATION_ID /var/lib/murakumo-observe ${cfg.scope}";
        Restart = "always";
        RestartSec = 5;
        StateDirectory = "murakumo-observe";
        StateDirectoryMode = "0750";
        UMask = "0027";
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictAddressFamilies = [ "AF_UNIX" ];
        CapabilityBoundingSet = "";
      };
    };
    # Only immutable app artifacts. Observation files are deliberately outside
    # this origin; the browser imports a file chosen by the local user.
    services.nginx = {
      enable = true;
      virtualHosts.murakumo-workspace = {
        listen = [ { addr = "127.0.0.1"; port = 18780; } ];
        root = "${cfg.package}/share/murakumo-workspace";
        locations."/".extraConfig = ''
          try_files $uri $uri/ =404;
          add_header X-Content-Type-Options nosniff always;
          add_header Referrer-Policy no-referrer always;
          add_header Cache-Control "no-store" always;
          add_header Content-Security-Policy "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; worker-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'" always;
        '';
      };
    };
    environment.systemPackages = [ cfg.package ];
    services.cage = lib.mkIf cfg.desktop {
      enable = true;
      user = "murakumo";
      program = "${pkgs.chromium}/bin/chromium --ozone-platform=wayland --app=http://127.0.0.1:18780/ --no-first-run --no-default-browser-check --disable-background-networking --disable-sync";
    };
    systemd.services.cage-tty1 = lib.mkIf cfg.desktop {
      after = [ "nginx.service" ];
      requires = [ "nginx.service" ];
      serviceConfig = { Restart = "always"; RestartSec = 5; };
    };
    users.users.murakumo = lib.mkIf cfg.desktop { isNormalUser = true; group = "users"; extraGroups = [ "video" "render" "murakumo-observe" ]; hashedPassword = "!"; };
    fonts.packages = lib.mkIf cfg.desktop [ pkgs.noto-fonts pkgs.noto-fonts-cjk-sans ];
    # Minimal installation media disables fontconfig. The browser desktop
    # needs its fonts/cache on both installed systems and live images.
    fonts.fontconfig.enable = lib.mkIf cfg.desktop (lib.mkForce true);
    hardware.graphics.enable = lib.mkIf cfg.desktop true;
  };
}
