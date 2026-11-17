{ pkgs ? import (import ../../../ci/nixpkgs.nix) { system = "x86_64-linux"; }, desktop ? false }:
pkgs.testers.runNixOSTest {
  name = "murakumo-nixos-native-workspace${if desktop then "-desktop" else ""}";
  enableOCR = desktop;
  nodes.machine = { lib, ... }: {
    imports = [ ../murakumo-nixos.nix ];
    networking.hostName = "murakumo-test";
    services.murakumoNative.scope = "nixos-vm";
    # This gate checks the native service and immutable asset delivery.
    # The graphical session and real browser journeys are separate gates.
    services.murakumoNative.desktop = desktop;
    services.cage.environment = lib.mkIf desktop { WLR_RENDERER = "pixman"; };
    virtualisation.qemu.options = lib.optionals desktop [ "-vga none -device virtio-gpu-pci" ];
    virtualisation.memorySize = if desktop then 3072 else 2048;
    virtualisation.cores = 2;
    environment.systemPackages = [ pkgs.curl pkgs.jq ];
  };
  testScript = ''
    import json
    start_all()
    machine.wait_for_unit("murakumo-node-monitor.service")
    machine.wait_for_unit("nginx.service")
    machine.wait_until_succeeds("test -s /var/lib/murakumo-observe/observation.json")
    before = json.loads(machine.succeed("cat /var/lib/murakumo-observe/observation.json"))
    assert before["scope"] == "nixos-vm" and before["signed"] is False
    assert before["enrollment"] == "unregistered" and before["cellRuntime"] is False
    assert before["memoryAvailableKiB"] > 0 and before["memoryTotalKiB"] > 0
    machine.wait_until_succeeds("test $(jq .sequence /var/lib/murakumo-observe/observation.json) -gt " + str(before["sequence"]))
    machine.succeed("curl --fail http://127.0.0.1:18780/ | grep 'Itonami workspace'")
    machine.succeed("curl --fail http://127.0.0.1:18780/kaikei.wasm > /tmp/kaikei.wasm")
    assert machine.succeed("curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18780/observation.json").strip() == "404"
    machine.succeed("! pgrep -x node; ! pgrep -x java; ! pgrep -x nbb")
    ${pkgs.lib.optionalString desktop ''
    machine.wait_for_unit("cage-tty1.service")
    machine.wait_until_succeeds("pgrep -u murakumo chromium")
    machine.wait_for_text("Local runtime ready")
    machine.screenshot("murakumo-nixos-workspace")
    machine.succeed("su murakumo -s /bin/sh -c 'test -r /var/lib/murakumo-observe/observation.json'")
    ''}
    machine.succeed("systemctl kill --signal=KILL murakumo-node-monitor.service")
    machine.wait_until_succeeds("systemctl is-active murakumo-node-monitor.service")
    machine.wait_until_succeeds("test $(jq -r .runId /var/lib/murakumo-observe/observation.json) != " + before["runId"])
    boot_id = machine.succeed("cat /proc/sys/kernel/random/boot_id").strip()
    machine.shutdown()
    machine.start()
    machine.wait_for_unit("murakumo-node-monitor.service")
    machine.wait_until_succeeds("test -s /var/lib/murakumo-observe/observation.json")
    machine.wait_until_succeeds("test $(jq -r .runId /var/lib/murakumo-observe/observation.json) = $(systemctl show -p InvocationID --value murakumo-node-monitor.service)")
    after = json.loads(machine.succeed("cat /var/lib/murakumo-observe/observation.json"))
    assert machine.succeed("cat /proc/sys/kernel/random/boot_id").strip() != boot_id
    assert after["linuxUptimeSeconds"] < before["linuxUptimeSeconds"] + 60
    machine.wait_for_unit("nginx.service")
    machine.wait_until_succeeds("curl --fail http://127.0.0.1:18780/ >/dev/null")
    machine.succeed("systemctl stop murakumo-node-monitor.service")
    machine.succeed("mkdir /tmp/refusal")
    machine.fail("KEXE_ALLOW=7,35,38,39 KEXE_CAP_RESOURCES_35=/tmp/refusal:/proc murakumo-node-monitor 'bad-label!' run /tmp/refusal nixos-vm")
    machine.succeed("test ! -e /tmp/refusal/observation.json")
    machine.copy_from_vm("/var/lib/murakumo-observe/observation.json", "observation-after-reboot.json")
  '';
}
