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
    # Prebuilt host-produced group: install into the guest disk and establish
    # a full logical-file baseline before shutting down the guest OS.
    machine.succeed("cp -R ${./test/fixtures/gib-reboot} /var/lib/forest-reboot/gib-store; chmod -R u+w /var/lib/forest-reboot/gib-store")
    machine.succeed("forest-reboot-probe read-gib /var/lib/forest-reboot/gib-store", timeout=900)
    machine.succeed("forest-reboot-probe create /var/lib/forest-reboot/store")
    machine.succeed("forest-reboot-probe create-v2 /var/lib/forest-reboot/store-v2")
    machine.succeed("forest-reboot-probe read /var/lib/forest-reboot/store")
    machine.succeed("forest-reboot-probe read-v2 /var/lib/forest-reboot/store-v2")
    boot_id = machine.succeed("cat /proc/sys/kernel/random/boot_id").strip()
    machine.shutdown()
    machine.start()
    machine.wait_for_unit("multi-user.target")
    assert machine.succeed("cat /proc/sys/kernel/random/boot_id").strip() != boot_id
    machine.succeed("forest-reboot-probe read /var/lib/forest-reboot/store")
    machine.succeed("forest-reboot-probe read-v2 /var/lib/forest-reboot/store-v2")
    machine.succeed("forest-reboot-probe read-gib /var/lib/forest-reboot/gib-store", timeout=900)
    # The guest-owned GiB fixture must also fail closed if any Pack is missing.
    machine.succeed("f=$(find /var/lib/forest-reboot/gib-store -type f -name '*.forest' -print -quit); test -n \"$f\"; mv \"$f\" /var/lib/forest-reboot/gib-missing.saved")
    machine.succeed("if forest-reboot-probe read-gib /var/lib/forest-reboot/gib-store > /tmp/forest-gib-missing.log 2>&1; then exit 1; fi; grep -q ':missing-forest' /tmp/forest-gib-missing.log", timeout=900)
    # Control: corrupt one VM-owned immutable archive only after successful
    # recovery, and require the precise digest rejection on a fresh process.
    machine.succeed("f=$(find /var/lib/forest-reboot/store -type f -name '*.forest' -print -quit); test -n \"$f\"; printf x >> \"$f\"")
    machine.succeed("if forest-reboot-probe read /var/lib/forest-reboot/store > /tmp/forest-corrupt.log 2>&1; then exit 1; fi; grep -q ':corrupt-forest' /tmp/forest-corrupt.log")
    machine.succeed("f=$(find /var/lib/forest-reboot/store-v2 -type f -name '*.forest' -print -quit); test -n \"$f\"; printf x >> \"$f\"")
    machine.succeed("if forest-reboot-probe read-v2 /var/lib/forest-reboot/store-v2 > /tmp/forest-v2-corrupt.log 2>&1; then exit 1; fi; grep -q ':invalid-forest' /tmp/forest-v2-corrupt.log")
    print("FOREST-GROUP-GUEST-REBOOT-PASS")
  '';
}
