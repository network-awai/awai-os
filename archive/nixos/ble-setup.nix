{ pkgs, lib, config, ... }:
let runtime = pkgs.runCommand "murakumo-ble-runtime" {} ''
  mkdir -p $out
  cp ${./ble-controller.mjs} $out/ble-controller.mjs
  cp ${./ble-protocol.mjs} $out/ble-protocol.mjs
'';
in {
  options.services.murakumoBle.enable = lib.mkEnableOption "local authenticated BLE Wi-Fi setup";
  config = lib.mkIf config.services.murakumoBle.enable {
    hardware.bluetooth.enable = true;
    environment.systemPackages = [ pkgs.bluez ];
    environment.etc."murakumo/ble-setup.nix".source = ./ble-setup.nix;
    environment.etc."murakumo/ble-controller.mjs".source = "${runtime}/ble-controller.mjs";
    environment.etc."murakumo/ble-protocol.mjs".source = "${runtime}/ble-protocol.mjs";
    environment.etc."murakumo/ble-gatt.js".source = ./ble-gatt.js;
    environment.etc."murakumo/ble-client.mjs".source = ./ble-client.mjs;
    environment.etc."murakumo/ble-setup.html".source = ./ble-setup.html;
    systemd.services.murakumo-ble-controller = {
      description = "Murakumo authenticated Bluetooth Wi-Fi setup controller";
      wantedBy = [ "multi-user.target" ];
      path = [ pkgs.networkmanager pkgs.iproute2 pkgs.curl ];
      environment.MURAKUMO_BLE_BACKEND = "networkmanager";
      serviceConfig = {
        ExecStart = "${pkgs.nodejs_22}/bin/node /etc/murakumo/ble-controller.mjs serve";
        RuntimeDirectory = "murakumo-ble";
        RuntimeDirectoryMode = "0700";
        UMask = "0077";
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        Restart = "on-failure";
      };
    };
    systemd.services.murakumo-ble-gatt = {
      description = "Murakumo Bluetooth setup peripheral";
      wantedBy = [ "multi-user.target" ];
      requires = [ "bluetooth.service" "murakumo-ble-controller.service" ];
      after = [ "bluetooth.service" "murakumo-ble-controller.service" ];
      unitConfig.ConditionPathExists = "/sys/class/bluetooth/hci0";
      path = [ pkgs.bluez pkgs.coreutils ];
      serviceConfig = {
        ExecStart = "${pkgs.gjs}/bin/gjs /etc/murakumo/ble-gatt.js";
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        Restart = "on-failure";
        RestartSec = 5;
      };
    };
  };
}
