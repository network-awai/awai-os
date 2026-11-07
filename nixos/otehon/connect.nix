{ config, lib, pkgs, ... }:
let
  bridge = pkgs.runCommand "otehon-connect-bridge" { nativeBuildInputs = [ pkgs.nodejs_22 ]; } ''
    mkdir -p $out
    cp ${./connect-bridge.mjs} $out/connect-bridge.mjs
    cp ${./connect-bridge.test.mjs} connect-bridge.test.mjs
    cp ${./connect-bridge.mjs} connect-bridge.mjs
    node --test connect-bridge.test.mjs
  '';
in
{
  # Tsunagu (JUN-318): Tailscale and Kekkai from inside the Awai OS VM.
  # tailscaled starts only after the user approves it in Tsunagu, which writes
  # the start condition below; Disconnect and Sign out remove it again.
  # Kekkai SSH pairing is the locally approved flow of remote-access.nix, with
  # Tsunagu as the local approval screen instead of the node console.
  imports = [ ../remote-access.nix ];

  services.murakumoRemote.enable = true;

  services.tailscale.enable = true;
  systemd.services.tailscaled.unitConfig.ConditionPathExists = "/var/lib/otehon-connect/tailscale-enabled";

  systemd.services.otehon-connect = {
    description = "Loopback bridge for the Tsunagu app";
    wantedBy = [ "multi-user.target" ];
    after = [ "network.target" "murakumo-remote.service" ];
    path = [ config.services.tailscale.package pkgs.systemd ];
    serviceConfig = {
      ExecStart = "${pkgs.nodejs_22}/bin/node ${bridge}/connect-bridge.mjs";
      StateDirectory = "otehon-connect";
      StateDirectoryMode = "0700";
      UMask = "0077";
      NoNewPrivileges = true;
      ProtectSystem = "strict";
      ProtectHome = true;
      Restart = "on-failure";
    };
  };
}
