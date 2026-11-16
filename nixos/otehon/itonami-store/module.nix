{ config, lib, pkgs, ... }:
let
  cfg = config.services.awai-itonami-store;
  verifiedBundle = pkgs.runCommand "awai-itonami-store-static" { nativeBuildInputs = [ pkgs.nodejs ]; } ''
    node ${./verify-bundle.mjs} ${cfg.bundle}
    mkdir -p "$out"
    cp -r ${cfg.bundle}/. "$out/"
  '';
  launcher = pkgs.makeDesktopItem {
    name = "awai-itonami-store";
    desktopName = "Itonami Store";
    comment = "Awai shared browser application catalog";
    exec = "${lib.getExe pkgs.chromium} --app=http://127.0.0.1:${toString cfg.port}/";
    categories = [ "Utility" ];
  };
in {
  options.services.awai-itonami-store = {
    enable = lib.mkEnableOption "the shared Awai Itonami Store static client";
    bundle = lib.mkOption {
      type = lib.types.path;
      description = "Immutable static output from android/export-web.py, qualified before deployment.";
    };
    port = lib.mkOption { type = lib.types.port; default = 8791; };
  };
  config = lib.mkIf cfg.enable {
    assertions = [{
      assertion = builtins.pathExists (cfg.bundle + "/bundle-manifest.json");
      message = "Itonami Store requires a qualified static bundle manifest.";
    }];
    services.nginx.enable = true;
    services.nginx.virtualHosts.awai-itonami-store = {
      listen = [{ addr = "127.0.0.1"; port = cfg.port; }];
      root = toString verifiedBundle;
      locations."/".extraConfig = ''
        try_files $uri $uri/ =404;
        add_header X-Content-Type-Options nosniff always;
        add_header Cache-Control "no-store" always;
      '';
    };
    environment.systemPackages = [ launcher ];
  };
}
