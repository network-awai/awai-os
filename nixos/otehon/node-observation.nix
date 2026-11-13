{ config, lib, ... }:
let
  cfg = config.otehon.nodeObservation;
  allowed = [
    "guest-sync" "guest-sync-delimited" "guest-ping" "guest-info"
    "guest-get-osinfo" "guest-get-time" "guest-network-get-interfaces"
  ];
in {
  options.otehon.nodeObservation.enable = lib.mkEnableOption
    "read-only guest observations over an owner-private virtio serial socket";

  config = lib.mkIf cfg.enable {
    services.qemuGuest.enable = true;
    # Use a positive allowlist: no exec, file writes, shutdown, password,
    # clock changes, filesystem freeze, CPU or interface reconfiguration.
    systemd.services.qemu-guest-agent.serviceConfig.ExecStart = lib.mkForce
      "${config.services.qemuGuest.package}/bin/qemu-ga --statedir /run/qemu-ga --allow-rpcs=${lib.concatStringsSep "," allowed}";
  };
}
