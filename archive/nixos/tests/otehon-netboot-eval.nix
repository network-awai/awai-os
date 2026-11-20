{ nixpkgsPath }:
let
  eval = extra: (import (nixpkgsPath + "/nixos/lib/eval-config.nix") {
    system = null;
    modules = [ ../otehon/netboot-diagnostic-6600h.nix extra ];
  }).config;
  key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA fixture";
  maintenance = eval { otehon.diagnosticPublicKey = key; otehon.diagnosticMaintenance = true; };
  missingKey = eval { otehon.diagnosticMaintenance = true; };
  offline = eval {};
  online = eval { otehon.diagnosticPublicKey = key; };
in
assert !offline.services.openssh.enable;
assert !offline.otehon.diagnosticMaintenance;
assert maintenance.security.sudo.enable;
assert maintenance.security.wrappers.sudo.setuid;
assert maintenance.services.openssh.settings.PermitRootLogin == "no";
assert maintenance.services.openssh.settings.PermitTTY;
assert !maintenance.services.openssh.settings.PasswordAuthentication;
assert maintenance.services.openssh.settings.DisableForwarding;
assert maintenance.services.openssh.settings.AllowUsers == [ "otehon-installer" ];
assert maintenance.systemd.services.otehon-install-broker.environment.OTEHON_DIAGNOSTIC_READ_ONLY == "1";
assert builtins.any (r: builtins.elem "otehon-installer" r.users) maintenance.security.sudo.extraRules;
assert builtins.all (a: a.assertion) maintenance.assertions;
assert !(builtins.all (a: a.assertion) missingKey.assertions);
assert online.services.openssh.enable;
assert !online.services.openssh.settings.PasswordAuthentication;
assert !online.services.openssh.settings.KbdInteractiveAuthentication;
assert online.services.openssh.settings.PermitRootLogin == "no";
assert online.services.openssh.settings.DisableForwarding;
assert !online.services.openssh.settings.PermitTTY;
assert online.services.openssh.settings.AllowUsers == [ "otehon-installer" ];
assert online.services.openssh.listenAddresses == [{ addr = "10.77.0.2"; port = 2222; }];
assert online.users.users.otehon-installer.openssh.authorizedKeys.keys == [ key ];
assert online.systemd.services.otehon-install-broker.environment.OTEHON_DIAGNOSTIC_READ_ONLY == "1";
assert online.systemd.services."otehon-install@".environment.OTEHON_DIAGNOSTIC_MODE == "1";
assert online.systemd.services.otehon-install-broker.serviceConfig.RestrictAddressFamilies == [ "AF_UNIX" ];
assert builtins.all (a: a.assertion) online.assertions;
{ defaultNoSsh = true; fixedKeyAndReadOnly = true; }
