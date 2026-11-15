{ pkgs ? import (import ../../ci/nixpkgs.nix) { system = "x86_64-linux"; } }:
let
  check = pkgs.writeText "check-device-usage.py" ''
    import errno, importlib.util, json, os, sys
    spec = importlib.util.spec_from_file_location('broker', '${../otehon/installer-broker.py}')
    b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
    rows = [r for r in b.inventory() if r['path'] in ('/dev/vdb', '/dev/vdc')]
    assert len(rows) == 2
    assert not any(r['used'] for r in rows), 'fixture must be invisible to root mount namespace'
    report = b.device_usage(rows)
    target = next(r for r in report['devices'] if r['path'] == '/dev/vdb')
    other = next(r for r in report['devices'] if r['path'] == '/dev/vdc')
    assert other['exclusiveReadOnlyOpen']['opened']
    if sys.argv[1] == 'held':
        assert target['exclusiveReadOnlyOpen']['errno'] == errno.EBUSY
        assert any(r['namespace'] != os.readlink('/proc/self/ns/mnt') for r in target['mountNamespaceReferences'])
        assert any(r['unit'] == 'usage-fd-fixture.service' for r in target['openFdReferences'])
    else:
        assert target['exclusiveReadOnlyOpen']['opened']
        assert not target['mountNamespaceReferences']
    print(json.dumps({'schema':'awai.otehon.device-usage-vm.v1','physicalDisks':False,'case':sys.argv[1],'passed':True}))
  '';
in pkgs.testers.runNixOSTest {
  name = "otehon-read-only-device-usage";
  nodes.machine = { ... }: {
    virtualisation = { memorySize = 1024; emptyDiskImages = [ 64 64 ]; };
    environment.systemPackages = [ pkgs.python3 pkgs.util-linux pkgs.e2fsprogs ];
    systemd.services.usage-mount-fixture = {
      path = [ pkgs.coreutils pkgs.util-linux ];
      serviceConfig.PrivateMounts = true;
      script = ''
        mount /dev/vdb /mnt/usage-fixture
        touch /run/usage-mount-ready
        sleep infinity
      '';
    };
    systemd.services.usage-fd-fixture = {
      script = ''
        exec ${pkgs.python3}/bin/python3 -c 'import os,time; fd=os.open("/dev/vdb",os.O_RDONLY); open("/run/usage-fd-ready","w").close(); time.sleep(600)'
      '';
    };
  };
  testScript = ''
    start_all()
    machine.wait_for_unit("multi-user.target")
    machine.succeed("mkdir -p /mnt/usage-fixture; mkfs.ext4 -q -F /dev/vdb; sha256sum /dev/vdc > /run/usage-before")
    machine.succeed("systemctl start usage-mount-fixture usage-fd-fixture")
    machine.wait_until_succeeds("test -f /run/usage-mount-ready -a -f /run/usage-fd-ready")
    machine.succeed("${pkgs.python3}/bin/python3 ${check} held")
    machine.succeed("systemctl stop usage-mount-fixture usage-fd-fixture")
    machine.succeed("${pkgs.python3}/bin/python3 ${check} released")
    machine.succeed("sha256sum -c /run/usage-before")
  '';
}
