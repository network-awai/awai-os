{ pkgs ? import (import ../../../ci/nixpkgs.nix) { system = "x86_64-linux"; } }:
let
  # Synthetic fixture key. Never used by an installer or a production profile.
  key = pkgs.writeText "drive-vm-only-key" "synthetic-drive-test-key";
  probe = pkgs.writeShellScriptBin "drive-probe" ''
    exec ${pkgs.python3}/bin/python3 ${./probe.py} "$@"
  '';
in pkgs.testers.runNixOSTest {
  name = "otehon-drive-encrypted-save-reboot-empty-cache";
  nodes.machine = { ... }: {
    imports = [ ../drive.nix ];
    virtualisation.memorySize = 2048;
    virtualisation.diskSize = 4096;
    virtualisation.emptyDiskImages = [ 1024 ];
    users.users.otehon = { isNormalUser = true; uid = 1000; };
    otehon.drive.enable = true;
    environment.systemPackages = [ probe pkgs.curl pkgs.xdg-user-dirs ];
    systemd.services.otehon-state = {
      wantedBy = [ "multi-user.target" ];
      after = [ "local-fs.target" ];
      path = [ pkgs.cryptsetup pkgs.e2fsprogs pkgs.util-linux pkgs.coreutils ];
      serviceConfig = { Type = "oneshot"; RemainAfterExit = true; };
      script = ''
        if ! cryptsetup isLuks /dev/vdb; then
          cryptsetup luksFormat --batch-mode --key-file ${key} /dev/vdb
        fi
        cryptsetup open --key-file ${key} /dev/vdb otehon-state
        if ! blkid /dev/mapper/otehon-state; then mkfs.ext4 -q /dev/mapper/otehon-state; fi
        mkdir -p /var/lib/otehon
        mount /dev/mapper/otehon-state /var/lib/otehon
        chmod 700 /var/lib/otehon
        install -d -m 700 -o otehon -g users /var/lib/otehon/home /home/otehon
        mount --bind /var/lib/otehon/home /home/otehon
      '';
    };
  };
  testScript = ''
    start_all()
    machine.wait_for_unit("otehon-drive-volume.service")
    machine.wait_for_unit("otehon-drive-mount.service")
    machine.wait_until_succeeds("runuser -u otehon -- mountpoint -q /home/otehon/Awai", timeout=120)
    machine.succeed("test $(findmnt -n -o FSTYPE --target /var/lib/otehon) = ext4")
    machine.succeed("${pkgs.cryptsetup}/bin/cryptsetup status otehon-state")
    machine.succeed("test $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8588/) = 401")
    machine.succeed("test $(runuser -u otehon -- xdg-user-dir DOCUMENTS) = /home/otehon/Awai")
    machine.succeed("runuser -u otehon -- drive-probe write /home/otehon/Awai/saved.bin")
    expected = machine.succeed("runuser -u otehon -- sha256sum /home/otehon/Awai/saved.bin").split()[0]
    machine.succeed("runuser -u otehon -- mv /home/otehon/Awai/saved.bin /home/otehon/Awai/renamed.bin")
    machine.succeed("runuser -u otehon -- drive-probe verify /home/otehon/Awai/renamed.bin")
    machine.wait_until_succeeds("runuser -u otehon -- awai-drive --status | ${pkgs.python3}/bin/python3 -c 'import json,sys; s=json.load(sys.stdin); assert s[\"localState\"] == \"transfer-idle\" and not s[\"distributedPolicyMet\"]'", timeout=120)
    machine.succeed("test $(stat -c %a /home/otehon/.local/state/awai-drive/credentials) = 600")
    # All bytes have explicit backend readback before treating this VM cache as clean.
    machine.succeed("systemctl stop otehon-drive-mount.service otehon-drive-volume.service")
    machine.fail("runuser -u otehon -- touch /home/otehon/Awai/must-not-fall-back.bin")
    machine.succeed("test ! -L /home/otehon/Awai")
    machine.succeed("mv /home/otehon/.local/state/awai-drive/cache /home/otehon/.local/state/awai-drive/cache-before-reboot; install -d -m 700 -o otehon -g users /home/otehon/.local/state/awai-drive/cache")
    boot_id = machine.succeed("cat /proc/sys/kernel/random/boot_id").strip()
    machine.shutdown()
    machine.start()
    machine.wait_for_unit("otehon-drive-mount.service")
    machine.wait_until_succeeds("runuser -u otehon -- mountpoint -q /home/otehon/Awai", timeout=120)
    assert machine.succeed("cat /proc/sys/kernel/random/boot_id").strip() != boot_id
    assert machine.succeed("runuser -u otehon -- sha256sum /home/otehon/Awai/renamed.bin").split()[0] == expected
    machine.succeed("runuser -u otehon -- drive-probe verify /home/otehon/Awai/renamed.bin")
    machine.succeed("runuser -u otehon -- test ! -e /home/otehon/Awai/saved.bin")
    # Missing/altered committed Pack must refuse startup rather than initialize or roll back.
    machine.succeed("systemctl stop otehon-drive-mount.service otehon-drive-volume.service")
    management = "find /home/otehon/.local/state/awai-drive/volume -type f ! -path '*/packs/*' -exec sha256sum {} + | sort | sha256sum"
    before = machine.succeed(management)
    machine.succeed("f=$(find /home/otehon/.local/state/awai-drive/volume/packs -name '*.car' -print -quit); test -n \"$f\"; printf x >> \"$f\"")
    machine.execute("systemctl start otehon-drive-volume.service")
    machine.wait_until_succeeds("journalctl -u otehon-drive-volume.service --no-pager | grep -q 'committed Pack'")
    machine.fail("curl --fail --max-time 2 http://127.0.0.1:8588/")
    machine.fail("runuser -u otehon -- awai-drive")
    assert machine.succeed(management) == before
    print("AWAI-2930 DRIVE SAVE/RENAME/GUEST-REBOOT/EMPTY-VFS-CACHE/CORRUPTION-REFUSAL PASS; LOCAL ENCRYPTED STATE ONLY")
  '';
}
