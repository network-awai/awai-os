{ config, lib, pkgs, ... }:
let
  cfg = config.otehon.drive;
  volume = import ./drive/package.nix { inherit pkgs; };
  home = config.users.users.${cfg.user}.home;
  state = "/var/lib/otehon/drive";
  mount = "${home}/Awai";
  settings = pkgs.writeText "otehon-drive-settings.json" (builtins.toJSON {
    inherit state mount; inherit (cfg) user; defaultSave = cfg.defaultSave;
  });
  prepare = pkgs.writeShellScript "otehon-drive-prepare" ''
    exec ${pkgs.python3}/bin/python3 ${./drive/prepare.py} ${settings}
  '';
  openDrive = pkgs.writeShellApplication {
    name = "awai-drive";
    runtimeInputs = [ pkgs.util-linux pkgs.xfce.thunar ];
    text = ''
      if ! mountpoint -q ${lib.escapeShellArg mount}; then
        echo 'Awai Drive は未接続です。暗号化データの解除と保存サービスを確認してください。' >&2
        exit 1
      fi
      exec thunar ${lib.escapeShellArg mount}
    '';
  };
in {
  options.otehon.drive = {
    enable = lib.mkEnableOption "the bounded local AwaiFS Drive save path";
    user = lib.mkOption { type = lib.types.str; default = "otehon"; };
    port = lib.mkOption { type = lib.types.port; default = 8588; };
    defaultSave = lib.mkOption { type = lib.types.bool; default = true;
      description = "Use Drive as Documents in a fresh home; preserve existing user directories."; };
    package = lib.mkOption { type = lib.types.package; readOnly = true; default = volume; };
  };
  config = lib.mkIf cfg.enable {
    assertions = [{ assertion = config.users.users.${cfg.user}.isNormalUser;
      message = "Awai Drive requires an existing normal desktop user"; }];
    boot.kernelModules = [ "fuse" ];
    programs.fuse.enable = true;
    environment.systemPackages = [ volume openDrive pkgs.xdg-user-dirs
      (pkgs.makeDesktopItem { name = "awai-drive"; desktopName = "Awai Drive";
        exec = "${openDrive}/bin/awai-drive"; icon = "folder"; categories = [ "System" "FileManager" ]; }) ];
    systemd.services.otehon-drive-prepare = {
      description = "Prepare private Awai Drive after encrypted state unlock";
      requires = [ "otehon-state.service" ];
      after = [ "otehon-state.service" ];
      before = [ "otehon-drive-volume.service" "otehon-drive-mount.service" ];
      path = [ pkgs.util-linux pkgs.coreutils ];
      serviceConfig = { Type = "oneshot"; RemainAfterExit = true; ExecStart = prepare; UMask = "0077"; };
    };
    systemd.services.otehon-drive-volume = {
      description = "AwaiFS single-writer local volume";
      wantedBy = [ "multi-user.target" ];
      wants = [ "otehon-drive-mount.service" ];
      requires = [ "otehon-drive-prepare.service" ];
      after = [ "otehon-drive-prepare.service" ];
      serviceConfig = {
        User = cfg.user; UMask = "0077"; EnvironmentFile = "${state}/credentials";
        ExecStartPre = pkgs.writeShellScript "otehon-drive-init" ''
          if [ ! -e ${state}/volume ]; then
            ${volume}/bin/awai-otehon-volume init ${state}/volume
          fi
          ${volume}/bin/awai-otehon-volume inspect ${state}/volume >/dev/null
        '';
        ExecStart = "${volume}/bin/awai-otehon-volume serve ${state}/volume ${toString cfg.port}";
        Restart = "on-failure"; RestartSec = 2;
        NoNewPrivileges = true; PrivateTmp = true; ProtectSystem = "strict";
        ReadWritePaths = [ state ]; ProtectHome = true;
      };
    };
    systemd.services.otehon-drive-mount = {
      description = "User-private Awai Drive filesystem";
      wantedBy = [ "multi-user.target" ];
      requires = [ "otehon-drive-volume.service" ];
      after = [ "otehon-drive-volume.service" ];
      bindsTo = [ "otehon-drive-volume.service" ];
      path = [ pkgs.fuse3 pkgs.curl pkgs.coreutils ];
      serviceConfig = {
        User = cfg.user; UMask = "0077"; EnvironmentFile = "${state}/credentials";
        ExecStartPre = pkgs.writeShellScript "otehon-drive-ready" ''
          for _ in $(${pkgs.coreutils}/bin/seq 1 60); do
            code=$(${pkgs.curl}/bin/curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:${toString cfg.port}/ || true)
            [ "$code" = 401 ] && exit 0
            ${pkgs.coreutils}/bin/sleep 1
          done
          exit 1
        '';
        ExecStart = "${pkgs.rclone}/bin/rclone mount :webdav: ${mount} --config /dev/null --webdav-url http://127.0.0.1:${toString cfg.port}/ --webdav-vendor other --vfs-cache-mode writes --cache-dir ${state}/cache --vfs-write-back 0s --dir-cache-time 1s --attr-timeout 1s --buffer-size 1M --transfers 1 --umask 077 --log-level ERROR";
        ExecStop = "/run/wrappers/bin/fusermount3 -u ${mount}";
        Restart = "on-failure"; RestartSec = 2; TimeoutStopSec = 120;
        Environment = "PATH=/run/wrappers/bin:${lib.makeBinPath [ pkgs.fuse3 pkgs.coreutils ]}";
      };
    };
  };
}
