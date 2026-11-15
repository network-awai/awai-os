{ nixpkgsPath }:
let
  eval = extra: (import (nixpkgsPath + "/nixos/lib/eval-config.nix") {
    system = null;
    modules = [ ../nixos/otehon/usb-install-6600h.nix extra ];
  }).config;
  off = eval {};
  on = eval { otehon.installerNbd = { enable = true; sha256 = "34b813c2ff6089b008d5901fac32c381c518f4514cd15c9173df0c7cf72ce704"; bytes = 8497463296; }; };
  bad = eval { otehon.installerNbd.enable = true; };
  installer = (import (nixpkgsPath + "/nixos/lib/eval-config.nix") {
    system = null;
    modules = [ ../nixos/otehon/netboot-nbd-install-6600h.nix {
      otehon.diagnosticPublicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA fixture";
    } ];
  }).config;
in
assert !off.otehon.installerNbd.enable;
assert builtins.elem "otehon-installer-source.service" on.systemd.services.otehon-install-broker.requires;
assert builtins.elem "nbd" on.boot.kernelModules;
assert builtins.all (a: a.assertion) on.assertions;
assert !(builtins.all (a: a.assertion) bad.assertions);
assert installer.otehon.installerNbd.enable;
assert installer.systemd.services.otehon-install-broker.environment.OTEHON_DIAGNOSTIC_READ_ONLY == "0";
assert installer.services.openssh.settings.PermitTTY;
assert installer.services.openssh.settings.DisableForwarding;
assert installer.services.openssh.settings.PermitRootLogin == "no";
assert builtins.all (a: a.assertion) installer.assertions;
{ sourceOptIn = true; requiresPinnedIdentity = true; }
