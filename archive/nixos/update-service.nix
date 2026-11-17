{ config, lib, pkgs, ... }:
let
 cfg = config.services.aiueosUpdate;
 runtime = pkgs.runCommand "aiueos-update-runtime" {} ''
   mkdir -p $out
   cp ${./update-release.mjs} $out/update-release.mjs
   cp ${./update-controller.mjs} $out/update-controller.mjs
   cp ${./update-linux.mjs} $out/update-linux.mjs
   cp ${./update-policy.mjs} $out/update-policy.mjs
   cp -r ${./update-policy-runtime} $out/update-policy-runtime
 '';
 command = mode: "${pkgs.util-linux}/bin/flock -n /run/aiueos-update.lock ${pkgs.nodejs_22}/bin/node ${runtime}/update-linux.mjs ${mode}";
 common = {
  path = with pkgs; [ nix systemd coreutils ];
  unitConfig.ConditionPathExists = "/var/lib/aiueos-update/config.json";
  serviceConfig = {
   Type = "oneshot"; User = "root"; UMask = "0077";
   StateDirectory = "aiueos-update"; StateDirectoryMode = "0700";
   TimeoutStartSec = "45min";
   # Nix import and EFI boot control are explicitly privileged mechanisms.
   # Config/keys never enter the Nix store and no remote command API exists.
  };
 };
in {
 options.services.aiueosUpdate.enable = lib.mkEnableOption "signed NixOS updates with trial boot recovery";
 config = lib.mkIf cfg.enable {
  systemd.services.aiueos-update = lib.recursiveUpdate common {
   description = "Verify, stage and apply signed NixOS releases";
   after = [ "network.target" "aiueos-update-recover.service" ];
   serviceConfig.ExecStart = command "check";
  };
  systemd.services.aiueos-update-recover = lib.recursiveUpdate common {
   description = "Commit a healthy trial or restore the retained NixOS boot";
   unitConfig.ConditionPathExists = "/var/lib/aiueos-update/journal.json";
   wantedBy = [ "multi-user.target" ];
   after = [ "local-fs.target" "NetworkManager.service" ];
   before = [ "aiueos-update.service" ];
   serviceConfig.ExecStart = command "recover";
  };
  systemd.timers.aiueos-update = {
   wantedBy = [ "timers.target" ];
   timerConfig = { OnBootSec = "5min"; OnUnitInactiveSec = "15min"; RandomizedDelaySec = "2min"; };
  };
  systemd.settings.Manager = { RuntimeWatchdogSec = "30s"; RebootWatchdogSec = "30s"; };
 };
}
