{ config, lib, pkgs, ... }:
let cfg=config.services.murakumoRemote;
 kekkai=import ./kekkai-runtime.nix { inherit pkgs; };
 runtime=pkgs.runCommand "murakumo-remote-runtime" {} ''
  mkdir -p $out
  cp ${./remote-access.mjs} $out/remote-access.mjs
  cp ${./remote-access.html} $out/remote-access.html
  cp ${./remote-client.js} $out/remote-client.js
  cp ${./remote-ui.mjs} $out/remote-ui.mjs
  cp ${./murakumo-logo.svg} $out/murakumo-logo.svg
  cp ${./node-status.mjs} $out/node-status.mjs
  cp ${kekkai}/client.tar.gz $out/kekkai-client.tar.gz
 '';
in {
 options.services.murakumoRemote.enable=lib.mkEnableOption "locally approved LAN management and SSH";
 config=lib.mkIf cfg.enable {
  users.users.murakumo-admin={isNormalUser=true;hashedPassword="!";extraGroups=["wheel"];};
  security.sudo.extraRules=[{users=["murakumo-admin"];commands=[{command="ALL";options=["NOPASSWD"]; }];}];
  services.openssh.enable=true;
  services.openssh.settings={PasswordAuthentication=false;KbdInteractiveAuthentication=false;PermitRootLogin="no";AllowUsers=["murakumo-admin"];};
  services.openssh.authorizedKeysFiles=["/etc/ssh/authorized_keys.d/%u"];
  systemd.services.sshd.unitConfig.ConditionPathExists="/etc/ssh/authorized_keys.d/murakumo-admin";
  systemd.tmpfiles.rules=["d /etc/ssh/authorized_keys.d 0755 root root -"];
  networking.firewall.allowedTCPPorts=[8443];
  networking.firewall.allowedUDPPorts=[41642 41643];
  systemd.services.murakumo-kekkai={
    description="Locally approved Kekkai setup SSH";
    wantedBy=["multi-user.target"];
    unitConfig.ConditionPathExists="/var/lib/murakumo-remote/kekkai/node.edn";
    after=["network.target" "sshd.service"];
    path=[pkgs.systemd];
    serviceConfig={ExecStart="${kekkai}/bin/murakumo-kekkai serve /var/lib/murakumo-remote/kekkai";
      Type="notify"; NotifyAccess="all"; TimeoutStartSec=60;
      User="root"; UMask="0077"; NoNewPrivileges=true; ProtectSystem="strict"; ProtectHome=true; Restart="on-failure";};
  };
  environment.etc."murakumo/kekkai-runtime.nix".source=./kekkai-runtime.nix;
  environment.etc."murakumo/kekkai-runtime.tar.gz".source=./kekkai-runtime.tar.gz;
  environment.etc."murakumo/kekkai-bootstrap.cljk".source=./kekkai-bootstrap.cljk;
  environment.etc."murakumo/kekkai-setup-client.mjs".source=./kekkai-setup-client.mjs;
  environment.etc."murakumo/remote-access.nix".source=./remote-access.nix;
  environment.etc."murakumo/remote-ui.mjs".source="${runtime}/remote-ui.mjs";
  environment.etc."murakumo/remote-access.mjs".source="${runtime}/remote-access.mjs";
  environment.etc."murakumo/remote-access.html".source=./remote-access.html;
  environment.etc."murakumo/remote-client.js".source=./remote-client.js;
  systemd.services.murakumo-remote={
   description="Locally approved Murakumo LAN management";
   wantedBy=["multi-user.target"];after=["network.target"];
   path=with pkgs;[openssl systemd networkmanager coreutils kekkai];
   serviceConfig={ExecStart="${pkgs.nodejs_22}/bin/node ${runtime}/remote-access.mjs";
    StateDirectory="murakumo-remote";StateDirectoryMode="0700";
    RuntimeDirectory="murakumo-remote";RuntimeDirectoryMode="0700";
    UMask="0077";NoNewPrivileges=true;ProtectSystem="strict";ProtectHome=true;
    ReadWritePaths=["/etc/ssh/authorized_keys.d"];Restart="on-failure";};
  };
 };
}
