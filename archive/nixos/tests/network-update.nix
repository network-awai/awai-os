{ pkgs ? import (import ../../../ci/nixpkgs.nix) { system = "x86_64-linux"; } }:
pkgs.testers.runNixOSTest {
  name = "murakumo-nixos-network-update";
  nodes.machine = { config, lib, extendModules, ... }: {
    imports = [ ../murakumo-nixos.nix ];
    networking.hostName = "murakumo-update-test";
    services.murakumoNative = {
      desktop = false;
      scope = "nixos-vm";
      networkUpdates = {
        enable = true;
        hostId = "network-update-test";
        healthUnits = [ "murakumo-node-monitor.service" "nginx.service" "sshd.service" "update-fixture.service" ];
        confirmationSeconds = 60;
        startupGraceSeconds = 15;
        minimumHealthySeconds = 5;
      };
    };
    boot.loader.systemd-boot.enable = true;
    boot.loader.grub.enable = lib.mkForce false;
    boot.loader.efi.canTouchEfiVariables = true;
    boot.loader.timeout = 1;
    virtualisation = {
      useBootLoader = true;
      useEFIBoot = true;
      diskSize = 6144;
      memorySize = 2048;
      cores = 2;
    };
    services.openssh = { enable = true; settings = { PasswordAuthentication = false; KbdInteractiveAuthentication = false; PermitRootLogin = "prohibit-password"; }; };
    environment.systemPackages = [ pkgs.jq pkgs.curl ];
    environment.etc."update-fixture-version".text = "old";
    systemd.services.update-fixture = {
      wantedBy = [ "multi-user.target" ];
      serviceConfig = { Type = "oneshot"; RemainAfterExit = true; };
      script = "exit 0";
    };
    # A deterministic interruption point in this test only, not a production
    # bypass or fault injection endpoint.
    systemd.services.murakumo-os-update-apply.serviceConfig.ExecStartPre = "${pkgs.coreutils}/bin/sleep 3";
    system.build.updateGood = (extendModules { modules = [{
      environment.etc."update-fixture-version".text = lib.mkForce "good";
      boot.kernelParams = [ "murakumo_update_trial=good" ];
    }]; }).config.system.build.toplevel;
    system.build.updateBad = (extendModules { modules = [{
      environment.etc."update-fixture-version".text = lib.mkForce "bad";
      systemd.services.update-fixture.script = lib.mkForce "exit 1";
    }]; }).config.system.build.toplevel;
    system.build.updateLost = (extendModules { modules = [{
      environment.etc."update-fixture-version".text = lib.mkForce "lost-confirmation";
    }]; }).config.system.build.toplevel;
    system.build.updateInterrupted = (extendModules { modules = [{
      environment.etc."update-fixture-version".text = lib.mkForce "interrupted";
    }]; }).config.system.build.toplevel;
    system.build.updateWrongHost = (extendModules { modules = [{
      services.murakumoNative.networkUpdates.hostId = lib.mkForce "another-host";
    }]; }).config.system.build.toplevel;
  };
  nodes.client = { nodes, ... }: {
    networking.extraHosts = "${nodes.machine.networking.primaryIPAddress} machine";
    environment.systemPackages = [ pkgs.nix pkgs.openssh pkgs.jq pkgs.bash pkgs.coreutils ];
    environment.etc."update-client".source = ../scripts/murakumo-network-update;
    environment.etc."update-candidates.json".text = builtins.toJSON {
      good = "${nodes.machine.system.build.updateGood}";
      bad = "${nodes.machine.system.build.updateBad}";
      lost = "${nodes.machine.system.build.updateLost}";
      interrupted = "${nodes.machine.system.build.updateInterrupted}";
      wrongHost = "${nodes.machine.system.build.updateWrongHost}";
    };
    virtualisation.memorySize = 1024;
    virtualisation.cores = 2;
    system.stateVersion = "26.05";
  };
  testScript = ''
    import json, shlex
    machine.start(allow_reboot=True)
    client.start()
    machine.wait_for_unit("sshd.service")
    machine.wait_for_unit("murakumo-os-update-guard.timer")
    machine.wait_for_unit("murakumo-node-monitor.service")
    client.wait_for_unit("multi-user.target")
    candidates = json.loads(client.succeed("cat /etc/update-candidates.json"))
    old = machine.succeed("readlink -e /run/current-system").strip()
    assert machine.succeed("readlink -e /nix/var/nix/profiles/system").strip() == old
    machine.succeed("test ! -e " + candidates["good"])
    machine.fail("nix-store --check-validity " + candidates["good"])
    machine.succeed("test -d /sys/firmware/efi; mountpoint /boot")
    machine.succeed("mkdir -m 700 -p /root/.ssh; printf 'persistent app state fixture\n' >/root/preserved-work; mkdir -p /var/lib/NetworkManager/system-connections; printf 'network fixture only\n' >/var/lib/NetworkManager/system-connections/fixture")
    preserved = machine.succeed("sha256sum /root/preserved-work /etc/machine-id /var/lib/NetworkManager/system-connections/fixture")
    client.succeed('mkdir -m 700 -p /root/.ssh; ssh-keygen -q -t ed25519 -N "" -f /root/.ssh/id_ed25519')
    public = client.succeed("cat /root/.ssh/id_ed25519.pub").strip()
    machine.succeed("printf '%s\n' " + shlex.quote(public) + " >/root/.ssh/authorized_keys; chmod 600 /root/.ssh/authorized_keys")
    # A new, untrusted SSH host must not cause an implicit key acceptance.
    client.fail("bash /etc/update-client root@machine " + candidates["good"])
    host_key = machine.succeed("cat /etc/ssh/ssh_host_ed25519_key.pub").strip()
    client.succeed("printf '%s\n' " + shlex.quote("machine " + host_key) + " >/root/.ssh/known_hosts")
    ssh_input = "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes root@machine "
    ssh = "ssh -n -o BatchMode=yes -o StrictHostKeyChecking=yes root@machine "
    client.succeed(ssh + "murakumo-os-update status")
    def refuses(command, reason):
        code, output = client.execute(command + " 2>&1")
        assert code != 0 and reason in output, (code, output)
    def state():
        return json.loads(machine.succeed("murakumo-os-update status"))
    def unchanged():
        assert machine.succeed("readlink -e /run/current-system").strip() == old
        assert machine.succeed("sha256sum /root/preserved-work /etc/machine-id /var/lib/NetworkManager/system-connections/fixture") == preserved
    # Truncated real NAR over SSH: import refuses and no boot/update begins.
    client.fail("set -o pipefail; nix-store --export " + candidates["good"] + " | head -c 256 | " + ssh_input + "nix-store --import")
    assert state()["phase"] == "idle"
    unchanged()
    # --stage-only really transfers to a target with an independent on-disk store.
    client.succeed("bash /etc/update-client root@machine " + candidates["good"] + " --stage-only", timeout=180)
    machine.succeed("set -o pipefail; nix-store --query --requisites " + candidates["good"] + " | xargs nix-store --check-validity")
    assert state()["phase"] == "idle"
    unchanged()
    wrong_hash = machine.succeed("nix-store --query --hash " + old).strip()
    refuses(ssh + "murakumo-os-update begin " + candidates["good"] + " " + wrong_hash, "candidate NAR hash mismatch")
    assert state()["phase"] == "idle"
    client.succeed("bash /etc/update-client root@machine " + candidates["wrongHost"] + " --stage-only", timeout=180)
    wrong_host_hash = client.succeed("nix-store --query --hash " + candidates["wrongHost"]).strip()
    refuses(ssh + "murakumo-os-update begin " + candidates["wrongHost"] + " " + wrong_host_hash, "candidate host/update contract mismatch")
    assert state()["phase"] == "idle"
    good_hash = client.succeed("nix-store --query --hash " + candidates["good"]).strip()
    machine.succeed("fallocate -l $(($(df -PB1 /var/lib/murakumo-os-update | awk 'END {print $4}') - 33554432)) /root/fixture-space-reservation")
    refuses(ssh + "murakumo-os-update begin " + candidates["good"] + " " + good_hash, "insufficient OS state filesystem space")
    machine.succeed("rm /root/fixture-space-reservation")
    assert state()["phase"] == "idle"
    unchanged()
    machine.succeed("systemd-run --unit=fixture-update-lock flock /var/lib/murakumo-os-update/lock ${pkgs.coreutils}/bin/sleep 10")
    machine.wait_until_succeeds("! flock -n /var/lib/murakumo-os-update/lock true")
    good_hash = client.succeed("nix-store --query --hash " + candidates["good"]).strip()
    refuses(ssh + "murakumo-os-update begin " + candidates["good"] + " " + good_hash, "another update operation is running")
    machine.wait_until_succeeds("flock -n /var/lib/murakumo-os-update/lock true")
    # Full updater: new kernel command line, UEFI trial, same host key,
    # sustained local health, fresh SSH confirmation, persistent commit.
    machine.connected = False
    client.succeed("bash /etc/update-client root@machine " + candidates["good"] + " >/tmp/good-update.json", timeout=240)
    good = state()
    assert good["phase"] == "committed" and good["new"] == candidates["good"]
    old = candidates["good"]
    machine.succeed("grep murakumo_update_trial=good /proc/cmdline")
    unchanged()
    machine.reboot()
    machine.wait_for_unit("sshd.service")
    unchanged()
    assert state()["phase"] == "committed"
    def begin(name):
        path = candidates[name]
        client.succeed("bash /etc/update-client root@machine " + path + " --stage-only", timeout=180)
        nar = client.succeed("nix-store --query --hash " + path).strip()
        result = json.loads(client.succeed(ssh + "murakumo-os-update begin " + path + " " + nar))
        machine.connected = False
        return result
    def wait_rollback(reason):
        machine.connected = False
        machine.wait_until_succeeds("test $(readlink -e /run/current-system) = " + old, timeout=180)
        machine.wait_until_succeeds("test $(jq -r .phase /var/lib/murakumo-os-update/journal.json) = rolled-back", timeout=180)
        outcome = state()
        assert outcome["reason"] == reason, outcome
        unchanged()
        return outcome
    bad = begin("bad")
    machine.wait_until_succeeds("test $(cat /etc/update-fixture-version) = bad", timeout=180)
    bad_outcome = wait_rollback("local-health-failed")
    # Losing the managing network/client cannot turn a trial into a commit.
    lost = begin("lost")
    machine.wait_until_succeeds("test $(jq -r .phase /var/lib/murakumo-os-update/journal.json) = awaiting-confirmation", timeout=180)
    client.succeed("ip link set eth1 down")
    machine.succeed("date -s '2025-01-01 00:00:00'")
    lost_outcome = wait_rollback("confirmation-timeout")
    client.succeed("ip link set eth1 up")
    client.wait_until_succeeds(ssh + "murakumo-os-update status")
    # Power cycle during the trial returns to the retained default, without
    # depending on the operator or its lost connection.
    interrupted = begin("interrupted")
    machine.wait_until_succeeds("test $(jq -r .phase /var/lib/murakumo-os-update/journal.json) = awaiting-confirmation", timeout=180)
    client.fail(ssh + "murakumo-os-update confirm 00000000-0000-0000-0000-000000000000")
    machine.crash()
    machine.start(allow_reboot=True)
    interrupted_outcome = wait_rollback("retained-generation-booted")
    # Interrupted preparation: journal survives; old boot remains usable.
    client.succeed("bash /etc/update-client root@machine " + candidates["lost"] + " --stage-only", timeout=180)
    nar = client.succeed("nix-store --query --hash " + candidates["lost"]).strip()
    client.succeed(ssh + "murakumo-os-update begin " + candidates["lost"] + " " + nar + " --retry-failed")
    machine.succeed("systemctl stop murakumo-os-update-apply.service")
    machine.crash()
    machine.start(allow_reboot=True)
    preparation_outcome = wait_rollback("retained-generation-booted")
    machine.succeed("! pgrep -x node; ! pgrep -x java; ! pgrep -x nbb")
    machine.succeed("test -e /var/lib/murakumo-os-update/roots/" + good["id"] + "-old")
    machine.succeed("test -e /var/lib/murakumo-os-update/roots/" + good["id"] + "-new")
    evidence = {"independentTargetNixStore": True, "strictHostKeyRefusal": True, "truncatedNarRefused": True, "realSshClosureTransfer": True, "wrongHashRefused": True, "wrongHostRefused": True, "lowStateSpaceRefused": True, "concurrentLockRefused": True, "committed": good, "badHealthRollback": bad_outcome, "lostNetworkRollback": lost_outcome, "trialPowerLossRollback": interrupted_outcome, "interruptedPreparationPowerLossRollback": preparation_outcome, "persistentStateUnchanged": True}
    with open("/tmp/network-update-proof.json", "w") as f:
        json.dump(evidence, f, indent=2)
    machine.copy_from_vm("/var/lib/murakumo-os-update/journal.json", "final-journal.json")
    client.copy_from_vm("/tmp/good-update.json", "good-update.json")
    # Save a deterministic proof artifact in the test output, without keys.
    import os
    with open(os.environ["out"] + "/network-update-proof.json", "w") as f:
        json.dump(evidence, f, indent=2)
  '';
}
