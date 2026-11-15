{ config, lib, pkgs, ... }:
let
  cfg = config.otehon.k3s;
  enabled = cfg.role != "off";
  server = cfg.role == "server";
  octet = "([0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])";
  ipv4 = value: builtins.match (lib.concatStringsSep "\\." (lib.replicate 4 octet)) value != null;
  cidrValid = value:
    let parts = lib.splitString "/" value;
    in builtins.length parts == 2 && ipv4 (builtins.head parts)
      && builtins.match "([0-9]|[12][0-9]|3[0-2])" (builtins.elemAt parts 1) != null;
  addressNumber = value: lib.foldl' (acc: part: acc * 256 + lib.toInt part) 0 (lib.splitString "." value);
  network = value:
    let parts = lib.splitString "/" value;
    in {
      ip = addressNumber (builtins.head parts);
      size = lib.foldl' (acc: _: acc * 2) 1 (builtins.genList (_: null) (32 - lib.toInt (builtins.elemAt parts 1)));
    };
  overlaps = a: b: let x = network a; y = network b; size = lib.max x.size y.size;
    in builtins.div x.ip size == builtins.div y.ip size;
  runtimePath = value: value != null && lib.hasPrefix "/" value
    && !(lib.hasPrefix "/nix/store/" value)
    && builtins.match "[a-zA-Z0-9/_.-]+" value != null
    && !(lib.any (part: lib.elem part [ "." ".." ]) (lib.splitString "/" value));
  peers = lib.concatStringsSep ", " cfg.peerAddresses;
  data = "${cfg.stateMount}/k3s";
  prepare = pkgs.writeShellScript "otehon-k3s-prepare" ''
    set -eu
    # Never create a plaintext replacement when encrypted state is unavailable.
    mountpoint -q ${lib.escapeShellArg cfg.stateMount}
    cryptsetup status otehon-state >/dev/null
    actual=$(findmnt -n -o MAJ:MIN --mountpoint ${lib.escapeShellArg cfg.stateMount})
    expected=$(lsblk -dn -o MAJ:MIN /dev/mapper/otehon-state)
    [ -n "$actual" ] && [ "$actual" = "$expected" ]
    token=${lib.escapeShellArg (if cfg.tokenFile == null then "/run/otehon-k3s/missing-token" else cfg.tokenFile)}
    [ -f "$token" ] && [ -s "$token" ]
    case "$(stat -Lc '%u:%a' "$token")" in 0:400|0:600) ;; *) exit 1 ;; esac
    [ "$(stat -Lc '%s' "$token")" -le 4096 ]
    install -d -m 0700 ${lib.escapeShellArg data} ${lib.escapeShellArg "${data}/agent/images"}
    ${lib.concatMapStringsSep "\n" (image: ''
      ln -sfn ${lib.escapeShellArg (toString image)} ${lib.escapeShellArg "${data}/agent/images/${image.name}"}
    '') cfg.images}
  '';
in {
  options.otehon.k3s = {
    role = lib.mkOption {
      type = lib.types.enum [ "off" "server" "agent" ]; default = "off";
      description = "Otehon OS cluster role; off preserves existing services and ports.";
    };
    nodeName = lib.mkOption { type = lib.types.str; default = config.networking.hostName; };
    nodeAddress = lib.mkOption { type = lib.types.str; default = ""; };
    interface = lib.mkOption { type = lib.types.str; default = "";
      description = "Explicit private guest interface, not the Mac host's Tailscale address."; };
    peerAddresses = lib.mkOption { type = lib.types.listOf lib.types.str; default = [ ]; };
    managementAddresses = lib.mkOption {
      type = lib.types.listOf lib.types.str; default = [ ];
      description = "Additional IPv4 clients allowed to reach the API on the cluster interface.";
    };
    serverAddress = lib.mkOption { type = lib.types.str; default = ""; };
    tokenFile = lib.mkOption { type = lib.types.nullOr lib.types.str; default = null;
      description = "Provisioned root-only runtime file; never token bytes in Nix/store."; };
    stateMount = lib.mkOption { type = lib.types.str; default = "/var/lib/otehon"; };
    podCIDR = lib.mkOption { type = lib.types.str; default = "10.42.0.0/16"; };
    serviceCIDR = lib.mkOption { type = lib.types.str; default = "10.43.0.0/16"; };
    images = lib.mkOption {
      type = lib.types.listOf lib.types.package;
      default = [ config.services.k3s.package.airgap-images ];
      description = "Nix-pinned images imported from encrypted K3s state, without registry pulls.";
    };
  };

  config = lib.mkIf enabled {
    assertions = [
      { assertion = ipv4 cfg.nodeAddress && lib.all ipv4 (cfg.peerAddresses ++ cfg.managementAddresses)
          && cfg.peerAddresses != [ ] && lib.elem cfg.nodeAddress cfg.peerAddresses;
        message = "Otehon K3s requires explicit private guest IPv4 addresses including this node."; }
      { assertion = builtins.match "[a-zA-Z0-9_.-]+" cfg.interface != null && cfg.interface != "lo";
        message = "Otehon K3s requires an explicit private cluster interface."; }
      { assertion = builtins.match "[a-z0-9]([a-z0-9.-]*[a-z0-9])?" cfg.nodeName != null
          && builtins.stringLength cfg.nodeName <= 63;
        message = "Otehon K3s requires a unique DNS-compatible node name."; }
      { assertion = runtimePath cfg.tokenFile && runtimePath cfg.stateMount;
        message = "Otehon K3s requires a runtime token file and state mount outside the Nix store."; }
      { assertion = if server then cfg.serverAddress == "" else
          builtins.match "https://[a-zA-Z0-9.-]+:6443" cfg.serverAddress != null;
        message = "Otehon K3s agent requires an explicit HTTPS server on port 6443; server bootstraps locally."; }
      { assertion = lib.all cidrValid [ cfg.podCIDR cfg.serviceCIDR ]
          && !(overlaps cfg.podCIDR cfg.serviceCIDR)
          && lib.all (ip: ipv4 ip && lib.all (cidr:
            let n = network cidr; in builtins.div (addressNumber ip) n.size != builtins.div n.ip n.size
          ) [ cfg.podCIDR cfg.serviceCIDR ]) cfg.peerAddresses;
        message = "Otehon K3s Pod, Service and peer networks must not overlap."; }
      { assertion = config.services.k3s.token == "" && config.services.k3s.agentToken == ""
          && config.services.k3s.configPath == null;
        message = "Otehon K3s credentials must use the private runtime token file."; }
      { assertion = config.services.k3s.images == [ ] && config.services.k3s.manifests == { };
        message = "Use Otehon K3s image provisioning; upstream default-directory manifests/images are not this encrypted data directory."; }
    ];

    services.k3s = {
      enable = true;
      inherit (cfg) role tokenFile nodeName;
      nodeIP = cfg.nodeAddress;
      serverAddr = cfg.serverAddress;
      # A single server with SQLite. Existing Bot/Circle etcd is independent.
      clusterInit = false;
      disable = lib.optionals server [ "traefik" "servicelb" "local-storage" "metrics-server" ];
      nodeTaint = lib.optionals server [ "node-role.kubernetes.io/control-plane=true:NoSchedule" ];
      extraFlags = [
        "--data-dir=${data}"
        "--flannel-iface=${cfg.interface}"
      ] ++ lib.optionals server [
        "--bind-address=${cfg.nodeAddress}"
        "--advertise-address=${cfg.nodeAddress}"
        "--tls-san=${cfg.nodeAddress}"
        "--cluster-cidr=${cfg.podCIDR}"
        "--service-cidr=${cfg.serviceCIDR}"
        "--write-kubeconfig-mode=0600"
        "--secrets-encryption"
      ];
      extraKubeletConfig = {
        containerLogMaxSize = "5Mi";
        containerLogMaxFiles = 2;
      };
    };
    systemd.services.otehon-k3s-prepare = {
      description = "Require private token and unlocked Otehon encrypted state before K3s";
      requires = [ "otehon-state.service" ];
      after = [ "otehon-state.service" ];
      before = [ "k3s.service" ];
      path = with pkgs; [ coreutils cryptsetup util-linux ];
      serviceConfig = { Type = "oneshot"; ExecStart = prepare; UMask = "0077"; };
    };
    systemd.services.k3s = {
      requires = [ "otehon-k3s-prepare.service" ];
      after = [ "otehon-k3s-prepare.service" ];
      bindsTo = [ "otehon-state.service" ];
      serviceConfig.UMask = "0077";
    };
    networking.nftables.enable = true;
    networking.firewall = {
      enable = true;
      checkReversePath = "loose";
      trustedInterfaces = [ "cni0" "flannel.1" ];
      extraInputRules = ''
        iifname "${cfg.interface}" ip saddr { ${peers} } tcp dport 10250 accept
        iifname "${cfg.interface}" ip saddr { ${peers} } udp dport 8472 accept
      '' + lib.optionalString server ''
        iifname "${cfg.interface}" ip saddr { ${lib.concatStringsSep ", " (lib.unique (cfg.peerAddresses ++ cfg.managementAddresses))} } tcp dport 6443 accept
      '';
    };
  };
}
