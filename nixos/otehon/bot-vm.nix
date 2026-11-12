{ config, lib, modulesPath, pkgs, ... }:
let
  source = ./bot-fleet/vm/vendor/itonami/otehon/src;
  sourcePin = builtins.fromJSON (builtins.readFile ./bot-fleet/vm/vendor/source.json);
  storage = ./storage;
  classpath = "${./bot-fleet/src}:${source}:${storage}/src:${storage}/vendor/apex/src:${storage}/vendor/apex-car/src";
  clientPin = pkgs.runCommand "awai-vm-etcd-client-pin" { } ''
    ${pkgs.coreutils}/bin/sha256sum ${pkgs.etcd}/bin/etcdctl | cut -d' ' -f1 > "$out"
  '';
  prepare = pkgs.writeShellScript "awai-vm-keys" ''
    set -eu
    disk=/dev/disk/by-id/virtio-itonami-vm-key
    for n in $(seq 1 20); do [ -b "$disk" ] && break; sleep 1; done
    test -b "$disk"
    install -d -m 700 /run/itonami-vm-keys /var/lib/itonami-bot-vm
    tar -xf "$disk" -C /run/itonami-vm-keys
    chmod 600 /run/itonami-vm-keys/*
    ${pkgs.babashka}/bin/bb --classpath '${classpath}' -e '
      (require (quote [clojure.edn :as e]) (quote [otehon.storage :as store]))
      (let [c (e/read-string (slurp "/run/itonami-vm-keys/node.edn"))
            c (-> c (assoc :state-root "/var/lib/itonami-bot-vm"
                           :runtime-revision "a9a1b2fc147cd7e9e5c640383fa6d72544c3449d")
                    (assoc-in [:etcd :etcdctl] "${pkgs.etcd}/bin/etcdctl")
                    (assoc-in [:etcd :etcdctl-sha256] (clojure.string/trim (slurp "${clientPin}"))))]
        (when-not (.exists (java.io.File. "/var/lib/itonami-bot-vm/packs"))
          (store/init! "/var/lib/itonami-bot-vm/packs"))
        (store/read-store "/var/lib/itonami-bot-vm/packs")
        (spit "/run/itonami-vm-keys/config.edn" (pr-str c)))'
  '';
  command = pkgs.writeShellScript "awai-vm-fixed-command" ''
    test "''${SSH_ORIGINAL_COMMAND:-}" = itonami-physics-v1 || exit 126
    export PATH=${lib.makeBinPath [ pkgs.openssl pkgs.coreutils ]}
    exec ${pkgs.coreutils}/bin/timeout --kill-after=5s 120s ${pkgs.babashka}/bin/bb \
      --classpath '${classpath}' -m bot-fleet.vm-worker /run/itonami-vm-keys/config.edn
  '';
in assert builtins.all (entry:
  builtins.hashFile "sha256" (source + "/${entry.path}") == entry.sha256
) sourcePin.files; {
  imports = [ ./common.nix "${modulesPath}/profiles/minimal.nix" ];
  system.image.id = "awai-itonami-bot-vm";
  system.image.version = "0.1.0-AWAI-2820";
  networking.hostName = lib.mkForce "awai-itonami-bot-vm";
  networking.firewall.enable = true;
  networking.firewall.allowedTCPPorts = [ 22 ];
  systemd.services.itonami-vm-keys = {
    wantedBy = [ "multi-user.target" ];
    before = [ "sshd.service" ];
    serviceConfig = { Type = "oneshot"; RemainAfterExit = true; ExecStart = prepare; };
    path = [ pkgs.coreutils pkgs.gnutar ];
  };
  systemd.services.sshd = { requires = [ "itonami-vm-keys.service" ]; after = [ "itonami-vm-keys.service" ]; };
  services.openssh = {
    enable = true;
    hostKeys = [ ];
    settings = {
      PasswordAuthentication = false; KbdInteractiveAuthentication = false;
      PermitRootLogin = "prohibit-password";
      AllowTcpForwarding = false; AllowAgentForwarding = false;
      X11Forwarding = false; PermitTunnel = false; PermitTTY = false;
      MaxSessions = 2; MaxStartups = "2:50:4";
      ForceCommand = "${command}";
      HostKey = "/run/itonami-vm-keys/ssh_host_ed25519_key";
    };
  };
  users.users.root.openssh.authorizedKeys.keys = [
    (lib.removeSuffix "\n" (builtins.readFile ./bot-fleet/vm/operator-authorized.pub))
  ];
  environment.systemPackages = [ pkgs.babashka pkgs.etcd pkgs.openssl ];
  boot.kernelParams = [ "panic=30" ];
  image.repart.partitions.root.repartConfig = {
    SizeMinBytes = lib.mkForce "4G";
    SizeMaxBytes = lib.mkForce "4G";
  };
}
