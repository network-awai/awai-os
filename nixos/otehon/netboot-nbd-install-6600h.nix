{ config, lib, pkgs, ... }:
let
  build = config.system.build;
  remote = pkgs.writeShellScript "otehon-install-session" ''
    export OTEHON_INSTALLER_INFO=${build.otehonInstallerInfo}
    export OTEHON_MEDIA_LABEL='LAN インストール'
    export OTEHON_ALLOW_INSTALL_OBSERVATION=1
    export PATH=${lib.makeBinPath [ pkgs.systemd ]}
    case "''${SSH_ORIGINAL_COMMAND-}" in
      ""|diagnostics) exec ${pkgs.python3}/bin/python3 ${./installer-diagnostics.py} ;;
      kernel-claims)
        export OTEHON_ALLOW_KERNEL_CLAIMS=1
        exec ${pkgs.python3}/bin/python3 ${./installer-diagnostics.py}
        ;;
      console)
        test -n "''${SSH_TTY-}" || exit 64
        exec ${build.otehonInstallerConsole} ssh
        ;;
      *) exit 64 ;;
    esac
  '';
in {
  imports = [ ./netboot-diagnostic-6600h.nix ];
  system.image.id = lib.mkOverride 40 "awai-otehon-netboot-nbd-install";
  networking.hostName = lib.mkOverride 40 "otehon-lan-installer";
  otehon.installerNbd = {
    enable = true;
    # Qualified 0.7.3 USB ISO; its embedded payload is independently admitted
    # by the shared broker's compressed/raw digests before and after writing.
    sha256 = "34b813c2ff6089b008d5901fac32c381c518f4514cd15c9173df0c7cf72ce704";
    bytes = 8497463296;
    payloadSha256 = "dda29e61981ec03d51c39381b86064c20051d37ab2e220747aa02d895bfb7efa";
    rawSha256 = "632c8a236b25717d84a594dd9dc12a4b88a54cf925fd37f95e3f8383eb03daa5";
    rawBytes = 27114078208;
  };
  systemd.services.otehon-install-broker.environment.OTEHON_DIAGNOSTIC_READ_ONLY = lib.mkForce "0";
  systemd.services."otehon-install@".environment = {
    OTEHON_DIAGNOSTIC_MODE = lib.mkForce "0";
    OTEHON_MEDIA_LABEL = "LAN インストール";
  };
  systemd.services.otehon-debug-fingerprint = lib.mkIf (config.otehon.diagnosticPublicKey != "") {
    serviceConfig.StandardOutput = "journal+console";
    script = lib.mkAfter ''
      echo 'LAN installer SSH host key (compare on Mac before connecting):'
      cat /run/otehon-debug-fingerprint
    '';
  };
  systemd.services.otehon-install-broker.path = [ pkgs.bpftrace ];
  systemd.services.otehon-install-broker.environment.OTEHON_KERNEL_CLAIM_SCRIPT = "${./installer-kernel-claims.py}";
  services.openssh.settings = lib.mkIf (config.otehon.diagnosticPublicKey != "") {
    ForceCommand = lib.mkForce "${remote}";
    PermitTTY = lib.mkForce true;
  };
}
