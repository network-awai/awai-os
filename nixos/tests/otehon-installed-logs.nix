{ pkgs ? import (import ../../ci/nixpkgs.nix) { system = "x86_64-linux"; } }:
let
  image = "/tmp/otehon-installed-journal.raw";
  common = { ... }: {
    virtualisation.memorySize = 1024;
    virtualisation.qemu.options = [
      "-drive" "file=${image},format=raw,if=none,id=installed"
      "-device" "virtio-blk-pci,drive=installed,serial=INSTALLED-LOGS"
    ];
    services.journald.storage = "persistent";
    environment.systemPackages = [ pkgs.python3 pkgs.util-linux pkgs.e2fsprogs ];
  };
  reader = "unshare --mount --propagation private ${pkgs.python3}/bin/python3 ${../otehon/installer-installed-logs.py}";
in pkgs.testers.runNixOSTest {
  name = "otehon-installed-boot-journal-read-only";
  nodes = {
    prepare = { ... }: { imports = [ common ]; };
    inspect = { ... }: { imports = [ common ../otehon/installer-storage-isolation.nix ]; };
  };
  testScript = ''
    import json
    with open("${image}", "xb") as disk:
        disk.truncate(256 * 1024 * 1024)
    target = "/dev/disk/by-id/virtio-INSTALLED-LOGS"
    prepare.start()
    prepare.wait_for_unit("multi-user.target")
    prepare.succeed(f"printf 'label: gpt\\nsize=192M, type=L, name=otehon-root\\ntype=L, name=otehon-state\\n' | sfdisk {target}; udevadm settle")
    prepare.succeed(f"mkfs.ext4 -F {target}-part1; mkdir /mnt/installed; mount {target}-part1 /mnt/installed; mkdir -p /mnt/installed/var/log/journal")
    prepare.succeed("systemd-run --wait --unit=greetd /bin/sh -c 'echo AWAI_PREVIOUS_BOOT_COMPOSITOR_FAILURE; exit 1' || true")
    prepare.succeed("journalctl --flush; journalctl --sync; cp -a /var/log/journal/. /mnt/installed/var/log/journal/; umount /mnt/installed; sync")
    before = prepare.succeed(f"sha256sum {target}").split()[0]
    previous_boot = prepare.succeed("cat /proc/sys/kernel/random/boot_id").strip().replace("-", "")
    prepare.shutdown()
    inspect.start()
    inspect.wait_for_unit("multi-user.target")
    result = json.loads(inspect.succeed("${reader}"))
    assert result["available"] and result["readOnly"], result
    journal = result["journal"]
    assert journal["available"] and journal["bootId"] == previous_boot, result
    assert "AWAI_PREVIOUS_BOOT_COMPOSITOR_FAILURE" in journal["text"], result
    assert inspect.succeed(f"sha256sum {target}").split()[0] == before, "offline read modified installed disk"
    # Mounted partitions are refused, even if someone else mounted them read-only.
    inspect.succeed(f"mkdir /mnt/installed; mount -o ro,noload {target}-part1 /mnt/installed")
    refused = json.loads(inspect.succeed("${reader}"))
    assert not refused["available"] and refused["reason"] == "root-already-mounted", refused
    inspect.succeed("umount /mnt/installed")
    assert inspect.succeed(f"sha256sum {target}").split()[0] == before
    # Ambiguous labels must not pick a disk silently.
    inspect.succeed(f"sfdisk --part-label {target} 2 otehon-root; udevadm settle")
    refused = json.loads(inspect.succeed("${reader}"))
    assert not refused["available"], refused
    print(json.dumps({"schema": "awai.otehon.installed-logs-vm.v1", "previousBoot": previous_boot, "readOnlyDiskSha256": before, "passed": True, "physicalDevice": False}))
  '';
}
