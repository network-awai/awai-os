{ pkgs ? import (import ../../ci/nixpkgs.nix) { system = "aarch64-linux"; }, bundle }:
pkgs.testers.runNixOSTest {
  name = "awai-itonami-store-browser";
  requiredFeatures.kvm = false;
  qemu.forceAccel = false;
  globalTimeout = 1800;
  nodes.machine = { ... }: {
    imports = [ ./module.nix ];
    services.awai-itonami-store = { enable = true; inherit bundle; };
    virtualisation.memorySize = 1536;
    virtualisation.cores = 2;
    users.users.storetest = { isNormalUser = true; createHome = true; };
    environment.systemPackages = [ pkgs.chromium pkgs.chromedriver (pkgs.python3.withPackages (p: [ p.selenium ])) ];
    system.stateVersion = "26.05";
  };
  testScript = ''
    start_all()
    machine.wait_for_unit("nginx.service")
    machine.wait_for_open_port(8791)
    machine.succeed("curl --fail http://127.0.0.1:8791/ | grep 'Awai Otehon'")
    machine.fail("curl --fail http://127.0.0.1:8791/packages/yotei.apk")
    machine.copy_from_host("${./vm-browser.py}", "/tmp/vm-browser.py")
    machine.succeed("install -d -m 700 -o storetest -g users /home/storetest/.local /home/storetest/.local/state /home/storetest/.local/share /home/storetest/.local/share/pki /home/storetest/.local/state/itonami-store")
    machine.succeed("runuser -u storetest -- python /tmp/vm-browser.py create", timeout=700)
    machine.copy_from_vm("/home/storetest/store-create.png", "store-create.png")
    machine.shutdown()
    machine.start()
    machine.wait_for_unit("nginx.service")
    machine.copy_from_host("${./vm-browser.py}", "/tmp/vm-browser.py")
    machine.succeed("runuser -u storetest -- python /tmp/vm-browser.py verify", timeout=700)
    machine.copy_from_vm("/home/storetest/store-verify.png", "store-verify.png")
  '';
}
