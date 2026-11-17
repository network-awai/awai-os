{ nixpkgsPath }:
let
  eval = extra: (import (nixpkgsPath + "/nixos/lib/eval-config.nix") {
    system = null;
    modules = [ ../../../otehon/usb-install-6600h.nix extra ];
  }).config;
  off = eval {};
  on = eval { otehon.installerNbd = { enable = true; sha256 = "34b813c2ff6089b008d5901fac32c381c518f4514cd15c9173df0c7cf72ce704"; bytes = 8497463296; payloadSha256 = "dda29e61981ec03d51c39381b86064c20051d37ab2e220747aa02d895bfb7efa"; rawSha256 = "632c8a236b25717d84a594dd9dc12a4b88a54cf925fd37f95e3f8383eb03daa5"; rawBytes = 27114078208; }; };
  bad = eval { otehon.installerNbd.enable = true; };
  missingPayload = eval { otehon.installerNbd = { enable = true; sha256 = "34b813c2ff6089b008d5901fac32c381c518f4514cd15c9173df0c7cf72ce704"; bytes = 8497463296; }; };
  installer = (import (nixpkgsPath + "/nixos/lib/eval-config.nix") {
    system = null;
    modules = [ ../../../otehon/netboot-nbd-install-6600h.nix {
      otehon.diagnosticPublicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA fixture";
    } ];
  }).config;
in
assert !off.otehon.installerNbd.enable;
assert builtins.elem "otehon-installer-source.service" on.systemd.services.otehon-install-broker.requires;
assert builtins.elem "nbd" on.boot.kernelModules;
assert builtins.all (a: a.assertion) on.assertions;
assert !(builtins.all (a: a.assertion) bad.assertions);
assert !(builtins.all (a: a.assertion) missingPayload.assertions);
assert installer.otehon.installerNbd.enable;
assert !installer.services.lvm.enable;
assert !installer.boot.initrd.services.lvm.enable;
assert !off.services.lvm.enable;
assert installer.systemd.services.otehon-install-broker.environment.OTEHON_DIAGNOSTIC_READ_ONLY == "0";
assert installer.services.openssh.settings.PermitTTY;
assert installer.services.openssh.settings.DisableForwarding;
assert installer.services.openssh.settings.PermitRootLogin == "no";
assert builtins.all (a: a.assertion) installer.assertions;
{ sourceOptIn = true; requiresPinnedIdentity = true; }
