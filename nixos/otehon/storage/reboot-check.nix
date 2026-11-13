{ pkgs ? import (import ../../../ci/nixpkgs.nix) { system = "x86_64-linux"; } }:
let
  classpath = "${./src}:${./vendor/apex/src}:${./vendor/apex-car/src}";
  probe = pkgs.writeShellScriptBin "forest-reboot-probe" ''
    export CROSSPACK_FIXTURES=${./test/fixtures/crosspack}
    export PATH=${pkgs.lib.makeBinPath [ pkgs.zstd ]}:$PATH
    exec ${pkgs.babashka}/bin/bb --classpath ${classpath} ${./test/otehon/reboot_probe.clj} "$@"
  '';
in
pkgs.testers.runNixOSTest {
  name = "otehon-forest-group-guest-reboot";
  nodes.machine = { ... }: {
    virtualisation.memorySize = 1024;
    virtualisation.diskSize = 2048;
    environment.systemPackages = [ probe ];
  };
  testScript = ''
    start_all()
    machine.wait_for_unit("multi-user.target")
    machine.succeed("mkdir -p /var/lib/forest-reboot")
    machine.succeed("forest-reboot-probe create /var/lib/forest-reboot/store")
    machine.succeed("forest-reboot-probe read /var/lib/forest-reboot/store")
    boot_id = machine.succeed("cat /proc/sys/kernel/random/boot_id").strip()
    machine.shutdown()
    machine.start()
    machine.wait_for_unit("multi-user.target")
    assert machine.succeed("cat /proc/sys/kernel/random/boot_id").strip() != boot_id
    machine.succeed("forest-reboot-probe read /var/lib/forest-reboot/store")
    print("FOREST-GROUP-GUEST-REBOOT-PASS")
  '';
}
