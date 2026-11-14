{ nixpkgsPath }:
let
  system = import (nixpkgsPath + "/nixos/lib/eval-config.nix") {
    system = null;
    modules = [ ../nixos/otehon/usb-install-6600h.nix ];
  };
  c = system.config;
  installed = (import (nixpkgsPath + "/nixos/lib/eval-config.nix") {
    system = null;
    modules = [ ../nixos/otehon/disk-6600h.nix ];
  }).config;
in
assert c.nixpkgs.hostPlatform.system == "x86_64-linux";
assert c.isoImage.makeEfiBootable && c.isoImage.makeUsbBootable;
assert !c.services.openssh.enable;
assert c.systemd.services."otehon-install@".environment.IMAGE_URL == "file:///iso/otehon/image.raw.zst";
assert !c.systemd.services."getty@tty1".enable;
assert !c.systemd.services."getty@tty2".enable;
assert builtins.elem "otehon-install@tty2.service" c.systemd.targets.multi-user.wants;
assert builtins.elem "otehon-install@tty1.service" c.systemd.targets.multi-user.wants;
assert c.services.xserver.displayManager.lightdm.extraConfig == "minimum-vt = 7";
assert c.boot.consoleLogLevel == 3 && !c.boot.initrd.verbose;
assert builtins.elem "systemd.show_status=false" c.boot.kernelParams;
assert builtins.elem "systemd-user-sessions.service" c.systemd.services."otehon-install@".after;
assert c.system.image.version == "0.7.1" && installed.system.image.version == "0.7.1";
assert installed.nix.enable;
assert c.systemd.services."otehon-install@".environment.OTEHON_REGISTER_BOOT == "1";
assert c.services.xserver.enable;
assert !c.systemd.services.otehon-boot-report.enable;
assert c.users.users.otehon-installer.isNormalUser;
assert c.services.displayManager.autoLogin.user == "otehon-installer";
assert c.systemd.services.otehon-install-broker.serviceConfig.RestrictAddressFamilies == [ "AF_UNIX" ];
assert installed.boot.plymouth.enable;
assert builtins.elem "plymouth.ignore-serial-consoles" installed.boot.kernelParams;
assert builtins.elem "console=ttyS0,115200" installed.boot.kernelParams;
assert builtins.elem "virtio_gpu" installed.boot.initrd.kernelModules;
assert builtins.all (a: a.assertion) c.assertions;
{ offlinePayload = true; explicitSerialAndErase = true; noRemoteAccess = true; uefiUsb = true; }
