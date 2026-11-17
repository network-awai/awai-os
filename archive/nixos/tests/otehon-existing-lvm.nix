{ pkgs ? import (import ../../../ci/nixpkgs.nix) { system = "x86_64-linux"; } }:
let
  image = "/tmp/otehon-previous-os.raw";
  common = { ... }: {
    virtualisation.memorySize = 1024;
    virtualisation.qemu.options = [
      "-drive" "file=${image},format=raw,if=none,id=previous-os"
      "-device" "virtio-blk-pci,drive=previous-os,serial=PREVIOUS-OS"
    ];
    environment.systemPackages = [ pkgs.python3 pkgs.util-linux ];
  };
  check = pkgs.writeText "existing-lvm-check.py" ''
    import errno, importlib.util, json, os, sys
    spec = importlib.util.spec_from_file_location('broker', '${../../../otehon/installer-broker.py}')
    b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
    rows = b.inventory()
    row = next(r for r in rows if r['serial']=='PREVIOUS-OS')
    assert len([p for p in row['partitions'] if p['type']=='part'])==3, row
    assert any(p['fstype']=='LVM2_member' for p in row['partitions']), row
    held = sys.argv[1]=='held'
    assert row['used']==held, row
    report = b.device_usage([row])
    item = report['devices'][0]
    if held:
        assert any(e.get('mapperKind')=='LVM' and e.get('mapperName')=='previous--os-root' for e in item['holderGraph']), item
        assert item['exclusiveReadOnlyOpen']['errno']==errno.EBUSY, item
        try: b.admit(rows, row['id'], 1)
        except b.Refused as error: assert str(error)=='target-in-use'
        else: raise AssertionError('active LVM admitted for overwrite')
    else:
        assert not item['holderGraph'], item
        assert item['exclusiveReadOnlyOpen']['opened'], item
        assert b.admit(rows, row['id'], 1)['id']==row['id']
    print(json.dumps({'schema':'awai.otehon.existing-lvm-vm.v1','held':held,'passed':True,'physicalDisks':False}))
  '';
in pkgs.testers.runNixOSTest {
  name = "otehon-existing-lvm-isolation";
  nodes = {
    prepare = { ... }: { imports = [ common ]; };
    control = { ... }: { imports = [ common ]; boot.initrd.systemd.enable = false; };
    isolatedlegacy = { ... }: {
      imports = [ common ../../../otehon/installer-storage-isolation.nix ];
      boot.initrd.systemd.enable = false;
    };
    isolatedsystemd = { ... }: {
      imports = [ common ../../../otehon/installer-storage-isolation.nix ];
      boot.initrd.systemd.enable = true;
    };
  };
  testScript = ''
    # One virtual disk is passed sequentially to fresh VMs: no process or RAM
    # state is carried from the previous OS to either installer configuration.
    with open("${image}", "xb") as disk:
        disk.truncate(128 * 1024 * 1024)
    target = "/dev/disk/by-id/virtio-PREVIOUS-OS"
    prepare.start()
    prepare.wait_for_unit("multi-user.target")
    prepare.succeed(f"printf 'label: gpt\\n,8M,L\\n,8M,L\\n,64M,L\\n' | sfdisk {target}; udevadm settle")
    prepare.succeed(f"pvcreate -y {target}-part3; vgcreate previous-os {target}-part3; lvcreate -y -L 8M -n root previous-os; udevadm settle")
    prepare.succeed("vgchange -an previous-os; sync")
    before = prepare.succeed(f"sha256sum {target}").split()[0]
    prepare.shutdown()
    control.start()
    control.wait_for_unit("multi-user.target")
    control.wait_until_succeeds("test -b /dev/mapper/previous--os-root", timeout=30)
    control.succeed("${pkgs.python3}/bin/python3 ${check} held")
    assert control.succeed(f"sha256sum {target}").split()[0] == before
    control.shutdown()
    for isolated in (isolatedlegacy, isolatedsystemd):
        isolated.start()
        isolated.wait_for_unit("multi-user.target")
        isolated.succeed("udevadm settle; test ! -b /dev/mapper/previous--os-root")
        isolated.succeed("${pkgs.python3}/bin/python3 ${check} free")
        assert isolated.succeed(f"sha256sum {target}").split()[0] == before
        isolated.shutdown()
  '';
}
