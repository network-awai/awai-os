{ config, lib, modulesPath, pkgs, ... }:
let
  cfg = config.otehon;
  enabled = cfg.diagnosticPublicKey != "";
  build = config.system.build;
  server = "http://10.77.0.1:8080";
  cmdline = "init=${build.toplevel}/init ${toString config.boot.kernelParams}";
  # Read-only diagnostics never admit or fetch a writable payload. Reuse the
  # qualified USB contract for inventory sizing without rebuilding its 27 GiB
  # disk just to read a previous boot journal.
  diagnosticDigests = pkgs.runCommand "otehon-diagnostic-digests" {} ''
    mkdir "$out"
    printf '%s\n' dda29e61981ec03d51c39381b86064c20051d37ab2e220747aa02d895bfb7efa > "$out/image"
    printf '%s\n' 632c8a236b25717d84a594dd9dc12a4b88a54cf925fd37f95e3f8383eb03daa5 > "$out/raw"
    printf '%s\n' 27114078208 > "$out/bytes"
  '';
  diagnostic = pkgs.writeShellScript "otehon-diagnostic-command" ''
    export OTEHON_ALLOW_INSTALLED_BOOT_LOGS=1
    export OTEHON_INSTALLER_INFO=${build.otehonInstallerInfo}
    export PATH=${lib.makeBinPath [ pkgs.systemd ]}
    exec ${pkgs.python3}/bin/python3 ${./installer-diagnostics.py}
  '';
  ipxe = pkgs.ipxe.override {
    embedScript = pkgs.writeText "otehon-diagnostic.ipxe" ''
      #!ipxe
      dhcp
      kernel ${server}/kernel initrd=initrd ${cmdline}
      initrd ${server}/initrd
      boot
    '';
  };
  image = pkgs.runCommand "awai-otehon-netboot-diagnostic" {} ''
    mkdir "$out"
    ln -s ${ipxe}/snp.efi "$out/ipxe.efi"
    ln -s ${build.kernel}/${config.system.boot.loader.kernelFile} "$out/kernel"
    ln -s ${build.netbootRamdisk}/initrd "$out/initrd"
    cp ${build.otehonInstallerInfo} "$out/installer-info.json"
  '';
in {
  imports = [ ./installer-runtime.nix "${modulesPath}/installer/netboot/netboot.nix" ];
  options.otehon.diagnosticPublicKey = lib.mkOption {
    type = lib.types.str;
    default = "";
    description = "Explicit operator Ed25519 public key; empty disables remote diagnostics.";
  };
  config = {
    assertions = [{
      assertion = !enabled || builtins.match "ssh-ed25519 [A-Za-z0-9+/=]+( [^\n\r]*)?" cfg.diagnosticPublicKey != null;
      message = "The LAN diagnostic public key must be one single Ed25519 public key.";
    }];
    system.image.id = lib.mkForce "awai-otehon-netboot-diagnostic";
    networking.hostName = lib.mkForce "otehon-diagnostic";
    networking.useDHCP = true;
    systemd.services.display-manager.enable = lib.mkForce false;
    systemd.services.otehon-install-broker.environment = {
      OTEHON_DIAGNOSTIC_READ_ONLY = "1";
      OTEHON_INSTALLED_LOG_SCRIPT = "${./installer-installed-logs.py}";
      DIGESTS = lib.mkIf (!config.otehon.installerNbd.enable) (lib.mkForce "${diagnosticDigests}");
    };
    systemd.services."otehon-install@".environment = {
      OTEHON_DIAGNOSTIC_MODE = "1";
      DIGESTS = lib.mkIf (!config.otehon.installerNbd.enable) (lib.mkForce "${diagnosticDigests}");
    };
    netboot.squashfsCompression = "zstd -Xcompression-level 6";
    system.build.image = lib.mkForce image;

    services.openssh = lib.mkIf enabled {
      enable = lib.mkForce true;
      ports = [ 2222 ];
      listenAddresses = [{ addr = "10.77.0.2"; port = 2222; }];
      hostKeys = [{ path = "/etc/ssh/ssh_host_ed25519_key"; type = "ed25519"; }];
      settings = {
        PermitRootLogin = "no";
        PasswordAuthentication = false;
        KbdInteractiveAuthentication = false;
        AllowUsers = [ "otehon-installer" ];
        ForceCommand = "${diagnostic}";
        PermitTTY = false;
        DisableForwarding = true;
        PermitUserEnvironment = false;
        PermitUserRC = false;
      };
    };
    networking.firewall.allowedTCPPorts = lib.optionals enabled [ 2222 ];
    systemd.services.sshd = lib.mkIf enabled {
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
    };
    users.users.otehon-installer.openssh.authorizedKeys.keys = lib.optional enabled cfg.diagnosticPublicKey;
    users.users.otehon-installer.extraGroups = lib.optionals enabled [ "systemd-journal" ];
    systemd.services.otehon-debug-fingerprint = lib.mkIf enabled {
      description = "Display this boot's SSH identity on the physical installer console";
      wantedBy = [ "multi-user.target" ];
      requires = [ "sshd-keygen.service" ];
      after = [ "sshd-keygen.service" ];
      before = [ "otehon-install@tty1.service" ];
      serviceConfig.Type = "oneshot";
      script = ''
        ${pkgs.openssh}/bin/ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub > /run/otehon-debug-fingerprint
        chmod 0644 /run/otehon-debug-fingerprint
      '';
    };
    systemd.services."otehon-install@".after = lib.optionals enabled [ "otehon-debug-fingerprint.service" ];
    systemd.services."otehon-install@".requires = lib.optionals enabled [ "otehon-debug-fingerprint.service" ];
    systemd.services."otehon-install@".environment.OTEHON_DIAGNOSTIC_FINGERPRINT = lib.mkIf enabled "/run/otehon-debug-fingerprint";
  };
}
