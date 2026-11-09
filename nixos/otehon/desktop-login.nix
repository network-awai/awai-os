{ config, lib, pkgs, ... }:
let
  relayHost = "relay.otehon.test";
  relayPort = 8443;
  relayOrigin = "https://${relayHost}:${toString relayPort}";
  # A throwaway certificate for the loopback relay in this check image.
  certificate = pkgs.runCommand "otehon-relay-test-certificate" { nativeBuildInputs = [ pkgs.openssl ]; } ''
    mkdir $out
    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
      -subj "/CN=${relayHost}" -addext "subjectAltName=DNS:${relayHost}" \
      -keyout $out/key.pem -out $out/cert.pem
  '';
in
{
  # Check image for ADR 0026 D13: the real shell, consent host and relay, driven through
  # DevTools by desktop-login-check-qemu.sh. It is not a release. The wallet and passkey
  # are simulated with random keys inside the driver.
  imports = [ ./desktop.nix ];

  system.image.id = lib.mkForce "awai-otehon-desktop-login";

  otehon = {
    inherit relayOrigin;
    e2e = true;
    browserArgs = [ "--ignore-certificate-errors" ];
  };

  networking.hosts."127.0.0.1" = [ relayHost ];

  services.ntfy-sh = {
    enable = true;
    settings = {
      base-url = relayOrigin;
      listen-http = "-";
      listen-https = ":${toString relayPort}";
      key-file = "${certificate}/key.pem";
      cert-file = "${certificate}/cert.pem";
      cache-duration = "10m";
    };
  };

  systemd.services.otehon-boot-report.enable = false;

  systemd.services.otehon-login-e2e = {
    description = "Drive the sign-in flow end to end";
    wantedBy = [ "graphical.target" ];
    after = [ "graphical.target" "ntfy-sh.service" ];
    # Check-only tools for in-VM diagnosis. Never a release path.
    path = [ pkgs.networkmanager pkgs.bluez pkgs.dbus pkgs.coreutils pkgs.bash pkgs.fcitx5 ];
    serviceConfig = {
      Type = "oneshot";
      StandardOutput = "tty";
      StandardError = "tty";
      TTYPath = "/dev/console";
    };
    environment = {
      RELAY_ORIGIN = relayOrigin;
      NODE_TLS_REJECT_UNAUTHORIZED = "0";
      EXPECTED_DAPPS = toString (builtins.length (lib.importJSON ./shell/src/dapps.json).dapps);
    };
    script = "${lib.getExe pkgs.nodejs} ${config.otehon.shell}/e2e-driver.mjs";
  };
}
