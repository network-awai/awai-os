{ nixpkgsPath }:
let
  system = import (nixpkgsPath + "/nixos/lib/eval-config.nix") {
    system = null;
    modules = [ ../nixos/otehon/usb-install-6600h.nix ];
  };
  c = system.config;
in
assert c.nixpkgs.hostPlatform.system == "x86_64-linux";
assert c.isoImage.makeEfiBootable && c.isoImage.makeUsbBootable;
assert !c.services.openssh.enable;
assert c.systemd.services."otehon-install@".environment.IMAGE_URL == "file:///iso/otehon/image.raw.zst";
assert !c.systemd.services."getty@tty1".enable;
assert c.services.xserver.enable;
assert !c.systemd.services.otehon-boot-report.enable;
assert c.users.users.otehon-installer.isNormalUser;
assert c.services.displayManager.autoLogin.user == "otehon-installer";
assert c.systemd.services.otehon-install-broker.serviceConfig.RestrictAddressFamilies == [ "AF_UNIX" ];
assert builtins.all (a: a.assertion) c.assertions;
{ offlinePayload = true; explicitSerialAndErase = true; noRemoteAccess = true; uefiUsb = true; }
