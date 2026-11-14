{ pkgs ? import (import ../../../ci/nixpkgs.nix) { system = "x86_64-linux"; } }:
let
  classpath = "${./src}:${./vendor/apex/src}:${./vendor/apex-car/src}";
  forestArchive = pkgs.fetchurl {
    url = "https://github.com/ChainSafe/forest/releases/download/v0.39.0/forest-v0.39.0-linux-amd64.zip";
    sha256 = "81224a9efed00353ec3c6cc5197f26abfdf48ed9458c1ce72b612e825d5bb64a";
  };
  forestTool = pkgs.runCommand "forest-tool-0.39.0-pinned" { nativeBuildInputs = [ pkgs.unzip ]; } ''
    mkdir -p "$out/bin"
    unzip -p ${forestArchive} forest-v0.39.0/forest-tool > "$out/bin/forest-tool"
    echo "7af03845db7324da80c5bc2848fe6897303b39cbac8bb701675e57ad82033ba0  $out/bin/forest-tool" | sha256sum --check
    chmod 0555 "$out/bin/forest-tool"
  '';
  probe = pkgs.writeShellScriptBin "forest-reboot-probe" ''
    export CROSSPACK_FIXTURES=${./test/fixtures/crosspack}
    export FOREST_TOOL=${forestTool}/bin/forest-tool
    export NIX_LD=/run/current-system/sw/share/nix-ld/lib/ld.so
    export NIX_LD_LIBRARY_PATH=/run/current-system/sw/share/nix-ld/lib
    export PATH=${pkgs.lib.makeBinPath [ pkgs.zstd ]}:$PATH
    exec ${pkgs.babashka}/bin/bb --classpath ${classpath} ${./test/otehon/reboot_probe.clj} "$@"
  '';
  gibWriterProbe = pkgs.writeShellScriptBin "forest-gib-writer-probe" ''
    export FOREST_TOOL=${forestTool}/bin/forest-tool
    export NIX_LD=/run/current-system/sw/share/nix-ld/lib/ld.so
    export NIX_LD_LIBRARY_PATH=/run/current-system/sw/share/nix-ld/lib
    export PATH=${pkgs.lib.makeBinPath [ pkgs.zstd ]}:$PATH
    exec ${pkgs.babashka}/bin/bb --classpath ${classpath} ${./oracle/gib_actual_writer.clj} "$@"
  '';
in
pkgs.testers.runNixOSTest {
  name = "otehon-forest-group-guest-reboot";
  nodes.machine = { ... }: {
    virtualisation.memorySize = 1024;
    virtualisation.diskSize = 6144;
    programs.nix-ld.enable = true;
    environment.systemPackages = [ probe gibWriterProbe forestTool ];
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
    machine.succeed("forest-reboot-probe create-large /var/lib/forest-reboot/store-large", timeout=900)
    machine.succeed("forest-reboot-probe read-large /var/lib/forest-reboot/store-large", timeout=900)
    # Guest creates and commits the full 1 GiB/64-Pack group itself.
    machine.succeed("GIB_ACTUAL_OUTPUT=/var/lib/forest-reboot/gib-actual forest-gib-writer-probe write", timeout=1800)
    machine.succeed("GIB_ACTUAL_OUTPUT=/var/lib/forest-reboot/gib-actual forest-gib-writer-probe read", timeout=1800)
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
    machine.succeed("forest-reboot-probe read-large /var/lib/forest-reboot/store-large", timeout=900)
    machine.succeed("GIB_ACTUAL_OUTPUT=/var/lib/forest-reboot/gib-actual forest-gib-writer-probe read", timeout=1800)
    # A missing guest-written Pack must not fall back to an older root.
    machine.succeed("f=$(find /var/lib/forest-reboot/gib-actual/store -type f -name '*.forest' -print -quit); test -n \"$f\"; mv \"$f\" /var/lib/forest-reboot/gib-actual-missing.saved")
    machine.succeed("if GIB_ACTUAL_OUTPUT=/var/lib/forest-reboot/gib-actual forest-gib-writer-probe read > /tmp/gib-actual-missing.log 2>&1; then exit 1; fi; grep -q ':missing-forest' /tmp/gib-actual-missing.log", timeout=1800)
    # Refuse a missing archive created by the guest's own writer.
    machine.succeed("f=$(find /var/lib/forest-reboot/store-large -type f -name '*.forest' -print -quit); test -n \"$f\"; mv \"$f\" /var/lib/forest-reboot/large-missing.saved")
    machine.succeed("if forest-reboot-probe read-large /var/lib/forest-reboot/store-large > /tmp/forest-large-missing.log 2>&1; then exit 1; fi; grep -q ':missing-forest' /tmp/forest-large-missing.log", timeout=900)
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
