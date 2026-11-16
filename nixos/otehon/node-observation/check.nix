{ pkgs ? import (import ../../../ci/nixpkgs.nix) { } }:
let
  nixpkgs = import ../../../ci/nixpkgs.nix;
  evaluate = enabled: import "${nixpkgs}/nixos/lib/eval-config.nix" {
    system = pkgs.stdenv.hostPlatform.system;
    modules = [ ../common.nix ../node-observation.nix {
      nixpkgs.hostPlatform = pkgs.stdenv.hostPlatform.system;
      otehon.nodeObservation.enable = enabled;
    } ];
  };
  enabled = (evaluate true).config;
  disabled = (evaluate false).config;
  allowlist = "guest-sync,guest-sync-delimited,guest-ping,guest-info,guest-get-osinfo,guest-get-time,guest-network-get-interfaces";
  command = enabled.systemd.services.qemu-guest-agent.serviceConfig.ExecStart;
in
assert !disabled.services.qemuGuest.enable;
assert enabled.services.qemuGuest.enable;
assert pkgs.lib.hasSuffix "--allow-rpcs=${allowlist}" command;
assert !enabled.services.openssh.enable;
assert enabled.networking.firewall.allowedTCPPorts == [ ];
pkgs.runCommand "otehon-read-only-node-observation-check" {
  nativeBuildInputs = [ enabled.services.qemuGuest.package ];
} ''
  mkdir -p "$out"
  qemu-ga --allow-rpcs=${allowlist} --dump-conf > "$out/agent-config.txt"
  echo 'default-off; explicit-read-only-allowlist; no-ssh; no-incoming-tcp' > "$out/tests.txt"
''
