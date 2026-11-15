{ pkgs ? import (import ../../ci/nixpkgs.nix) { system = "x86_64-linux"; } }:
let
  check = pkgs.writeText "check-device-usage.py" ''
    import errno, importlib.util, json, os, sys
    spec = importlib.util.spec_from_file_location('broker', '${../otehon/installer-broker.py}')
    b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
    trace_spec = importlib.util.spec_from_file_location('claims', '${../otehon/installer-kernel-claims.py}')
    claims = importlib.util.module_from_spec(trace_spec); trace_spec.loader.exec_module(claims)
    rows = [r for r in b.inventory() if r['path'] in ('/dev/vdb', '/dev/vdc')]
    assert len(rows) == 2
    assert all(not r["ambiguous"] for r in rows), "fixture disks need real unique QEMU serials"
    if sys.argv[1] not in ('loop', 'raw-loop'):
        assert not any(r['used'] for r in rows), 'fixture must be invisible to root mount namespace'
    report = b.device_usage(rows)
    target = next(r for r in report['devices'] if r['path'] == '/dev/vdb')
    other = next(r for r in report['devices'] if r['path'] == '/dev/vdc')
    assert other['exclusiveReadOnlyOpen']['opened']
    if sys.argv[1] == 'held':
        assert target['exclusiveReadOnlyOpen']['errno'] == errno.EBUSY
        assert any(r['namespace'] != os.readlink('/proc/self/ns/mnt') for r in target['mountNamespaceReferences'])
        assert any(r['unit'] == 'usage-fd-fixture.service' for r in target['openFdReferences'])
    elif sys.argv[1] == 'exclusive':
        assert target['exclusiveReadOnlyOpen']['errno'] == errno.EBUSY
        assert any(r['unit']=='usage-exclusive-fixture.service' for r in target['openFdReferences'])
    elif sys.argv[1] in ('loop', 'raw-loop'):
        if sys.argv[1] == 'loop':
            assert target['exclusiveReadOnlyOpen']['errno'] == errno.EBUSY
        else:
            assert target['exclusiveReadOnlyOpen']['opened'], 'raw loop illustrates why O_EXCL alone is insufficient'
        assert next(r for r in rows if r['path']=='/dev/vdb')['used']
        try: b.admit(rows, target['id'], 1)
        except b.Refused as error: assert str(error)=='target-in-use'
        else: raise AssertionError('loop-backed disk admitted for install')
        assert target['loopReferences'], 'kernel loop backing reference must survive an orphaned mount'
        assert not target['mountNamespaceReferences']
        assert not target['openFdReferences']
    else:
        assert target['exclusiveReadOnlyOpen']['opened']
        assert not target['mountNamespaceReferences']
    if sys.argv[1] in ('held', 'exclusive', 'released'):
        trace = claims.inspect(rows)
        assert trace['available'], trace
        held = next(r for r in trace['devices'] if r['path']=='/dev/vdb')
        if sys.argv[1] == 'held':
            assert held['kernel']['hasHolder']
            assert held['kernel']['holderOps']=='fs_holder_ops', trace
            assert held['kernel']['fileSystem']=='ext4', trace
            assert held['kernel']['returnCode']==-errno.EBUSY, trace
        elif sys.argv[1] == 'exclusive':
            assert held['kernel']['holderKind']=='block-file', trace
            assert held['kernel']['holderFileFlags'] & os.O_ACCMODE == os.O_RDONLY, trace
            assert held['kernel']['holderUid']==0, trace
            assert held['kernel']['returnCode']==-errno.EBUSY, trace
        else:
            assert not held['kernel']['hasHolder'], trace
            assert held['kernel']['returnCode']==0, trace
    print(json.dumps({'schema':'awai.otehon.device-usage-vm.v1','physicalDisks':False,'case':sys.argv[1],'passed':True}))
  '';
in pkgs.testers.runNixOSTest {
  name = "otehon-read-only-device-usage";
  nodes.machine = { ... }: {
    virtualisation = {
      memorySize = 2048;
      emptyDiskImages = [
        { size = 64; driveConfig.deviceExtraOpts.serial = "USAGE-TARGET"; }
        { size = 64; driveConfig.deviceExtraOpts.serial = "USAGE-DECOY"; }
      ];
    };
    boot.kernelModules = [ "loop" ];
    environment.systemPackages = [ pkgs.python3 pkgs.util-linux pkgs.e2fsprogs pkgs.bpftrace ];
    systemd.services.usage-mount-fixture = {
      path = [ pkgs.coreutils pkgs.util-linux ];
      serviceConfig.PrivateMounts = true;
      script = ''
        mount /dev/vdb /mnt/usage-fixture
        touch /run/usage-mount-ready
        sleep infinity
      '';
    };
    systemd.services.usage-exclusive-fixture = {
      script = ''
        exec ${pkgs.python3}/bin/python3 -c 'import os,time; fd=os.open("/dev/vdb",os.O_RDONLY|os.O_EXCL); open("/run/usage-exclusive-ready","w").close(); time.sleep(600)'
      '';
    };
    systemd.services.usage-fd-fixture = {
      script = ''
        cp -a /dev/vdb /dev/usage-alias
        exec ${pkgs.python3}/bin/python3 -c 'import os,time; fd=os.open("/dev/usage-alias",os.O_RDONLY); open("/run/usage-fd-ready","w").close(); time.sleep(600)'
      '';
    };
  };
  testScript = ''
    start_all()
    machine.wait_for_unit("multi-user.target")
    machine.succeed("mkdir -p /mnt/usage-fixture; mkfs.ext4 -q -F /dev/vdb; sha256sum /dev/vdc > /run/usage-before")
    machine.succeed("systemctl start usage-mount-fixture usage-fd-fixture")
    machine.wait_until_succeeds("test -f /run/usage-mount-ready -a -f /run/usage-fd-ready", timeout=30)
    machine.succeed("${pkgs.python3}/bin/python3 ${check} held")
    machine.succeed("systemctl stop usage-mount-fixture usage-fd-fixture")
    machine.succeed("${pkgs.python3}/bin/python3 ${check} released")
    machine.succeed("systemctl start usage-exclusive-fixture")
    machine.wait_until_succeeds("test -f /run/usage-exclusive-ready", timeout=30)
    machine.succeed("${pkgs.python3}/bin/python3 ${check} exclusive")
    machine.succeed("systemctl stop usage-exclusive-fixture")
    machine.succeed("${pkgs.python3}/bin/python3 ${check} released")
    machine.succeed("mount /dev/vdb /mnt/usage-fixture; truncate -s 8M /mnt/usage-fixture/backing; losetup --find --show /mnt/usage-fixture/backing > /run/usage-loop; umount -l /mnt/usage-fixture")
    machine.succeed("${pkgs.python3}/bin/python3 ${check} loop")
    machine.succeed("losetup -d $(cat /run/usage-loop)")
    machine.succeed("${pkgs.python3}/bin/python3 ${check} released")
    machine.succeed("losetup --find --show /dev/vdb > /run/usage-loop")
    machine.succeed("${pkgs.python3}/bin/python3 ${check} raw-loop")
    machine.succeed("losetup -d $(cat /run/usage-loop)")
    machine.succeed("${pkgs.python3}/bin/python3 ${check} released")
    machine.succeed("sha256sum -c /run/usage-before")
  '';
}
