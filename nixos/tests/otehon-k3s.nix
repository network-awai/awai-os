{ pkgs ? import (import ../../ci/nixpkgs.nix) { system = "x86_64-linux"; } }:
let
  inherit (pkgs) lib;
  addresses = { jacob = "192.168.1.1"; dan = "192.168.1.2"; judah = "192.168.1.3"; };
  # Local image with no registry or application/network dependency.
  image = pkgs.dockerTools.buildImage {
    name = "otehon-test"; tag = "local";
    copyToRoot = pkgs.buildEnv { name = "otehon-test-root"; paths = [ pkgs.busybox ]; pathsToLink = [ "/bin" ]; };
    config.Cmd = [ "/bin/sleep" "3600" ];
  };
  machine = node: { config, ... }: {
    imports = [ (import ../otehon/k3s/fleet.nix {
      inherit node addresses; interface = "eth1"; tokenFile = "/run/secrets/otehon-k3s-token";
    }) ];
    virtualisation = {
      memorySize = if node == "jacob" then 2304 else 1536;
      cores = 2;
      emptyDiskImages = [ 4096 ];
    };
    networking.interfaces.eth1.ipv4.addresses = lib.mkForce [{ address = addresses.${node}; prefixLength = 24; }];
    otehon.k3s.images = [ config.services.k3s.package.airgap-images image ];
    environment.systemPackages = with pkgs; [ kubectl jq cryptsetup ];
    environment.variables.KUBECONFIG = "/etc/rancher/k3s/k3s.yaml";
    # Runtime-only fixture credentials/blank test disks. This fixture is NOT an
    # image profile and never connects to the real fleet or formats a host disk.
    systemd.services.otehon-state = {
      wantedBy = [ "multi-user.target" ]; before = [ "otehon-k3s-prepare.service" ];
      path = with pkgs; [ coreutils cryptsetup e2fsprogs util-linux ];
      serviceConfig = { Type = "oneshot"; RemainAfterExit = true; };
      script = ''
        test ! -e /var/lib/test-lock-state
        if [ ! -f /var/lib/test-luks-key ]; then
          head -c 32 /dev/urandom > /var/lib/test-luks-key
          chmod 600 /var/lib/test-luks-key
        fi
        if ! cryptsetup isLuks /dev/vdb; then
          cryptsetup luksFormat --batch-mode --pbkdf pbkdf2 --key-file /var/lib/test-luks-key /dev/vdb
        fi
        cryptsetup open --key-file /var/lib/test-luks-key /dev/vdb otehon-state
        if ! blkid /dev/mapper/otehon-state; then mkfs.ext4 -q /dev/mapper/otehon-state; fi
        install -d -m 700 /var/lib/otehon
        mount /dev/mapper/otehon-state /var/lib/otehon
        install -d -m 700 /run/secrets
        ${lib.optionalString (node != "judah") ''
          printf '%s' '${if node == "dan" then "wrong-test-token" else "otehon-test-token-not-production"}' > /run/secrets/otehon-k3s-token
          chmod 600 /run/secrets/otehon-k3s-token
        ''}
      '';
      preStop = ''
        umount /var/lib/otehon
        cryptsetup close otehon-state
      '';
    };
    systemd.services.existing-service = {
      wantedBy = [ "multi-user.target" ];
      serviceConfig.ExecStart = "${pkgs.coreutils}/bin/sleep infinity";
    };
  };
in pkgs.testers.runNixOSTest {
  name = "awai-otehon-k3s";
  nodes = {
    jacob = machine "jacob";
    dan = machine "dan";
    judah = machine "judah";
    disabled = { ... }: {
      imports = [ ../otehon/k3s/default.nix ];
      virtualisation.memorySize = 512;
      environment.systemPackages = [ pkgs.curl ];
      networking.interfaces.eth1.ipv4.addresses = lib.mkForce [{ address = "192.168.1.4"; prefixLength = 24; }];
    };
  };
  testScript = ''
    import json
    from pathlib import Path

    jacob.start(allow_reboot=True)
    for vm in [dan, judah, disabled]:
        vm.start()
    for vm in [jacob, dan, judah, disabled]:
        vm.wait_for_unit("multi-user.target")

    with subtest("disabled role starts no K3s and opens no API"):
        disabled.fail("systemctl cat k3s.service")
        disabled.fail("ss -lnt | grep :6443")

    with subtest("missing token refuses before writing K3s state"):
        judah.wait_until_succeeds("systemctl is-failed otehon-k3s-prepare.service")
        judah.fail("test -e /var/lib/otehon/k3s")

    with subtest("locked state has no plaintext fallback"):
        judah.succeed("systemctl stop otehon-state; touch /var/lib/test-lock-state")
        judah.execute("systemctl reset-failed; systemctl start k3s", check_return=False)
        judah.fail("mountpoint -q /var/lib/otehon")
        judah.fail("test -e /var/lib/otehon/k3s")
        judah.succeed("rm /var/lib/test-lock-state; systemctl reset-failed; systemctl start otehon-state")

    jacob.wait_for_unit("k3s.service", timeout=300)
    jacob.wait_until_succeeds("""kubectl get node jacob -o json | jq -e ' .status.conditions[] | select(.type == "Ready") | .status == "True"'""", timeout=300)

    with subtest("wrong token cannot enroll dan"):
        dan.wait_until_succeeds("journalctl -u k3s --no-pager | grep -Ei 'Unauthorized|401|token.*(invalid|validation|failed)|not authorized|failed.*token'", timeout=120)
        jacob.fail("kubectl get node dan")

    for vm in [dan, judah]:
        vm.succeed("printf '%s' otehon-test-token-not-production > /run/secrets/otehon-k3s-token; chmod 600 /run/secrets/otehon-k3s-token; systemctl stop k3s; systemctl reset-failed; systemctl start k3s")

    with subtest("three named nodes ready; API inaccessible from unlisted peer"):
        jacob.wait_until_succeeds("kubectl wait --for=condition=Ready node/jacob node/dan node/judah --timeout=20s", timeout=300)
        disabled.fail("curl --connect-timeout 3 -sk https://192.168.1.1:6443/readyz")
        jacob.succeed("test $(stat -c %a /etc/rancher/k3s/k3s.yaml) = 600")
        jacob.succeed("test -f /var/lib/otehon/k3s/server/db/state.db")

    sentinel = {vm.name: vm.succeed("systemctl show existing-service -p MainPID --value").strip() for vm in [jacob, dan, judah]}
    with subtest("real Pods run on workers and communicate across nodes"):
        for name in ["dan", "judah"]:
            pod = {"apiVersion": "v1", "kind": "Pod", "metadata": {"name": "work-" + name},
                   "spec": {"nodeSelector": {"kubernetes.io/hostname": name},
                            "containers": [{"name": "work", "image": "otehon-test:local", "imagePullPolicy": "Never",
                              "command": ["/bin/sh", "-c", "mkdir -p /tmp/www; echo worker-ok > /tmp/www/index.html; exec httpd -f -p 8080 -h /tmp/www"]}]}}
            jacob.succeed("printf '%s' '" + json.dumps(pod) + "' | kubectl apply -f -")
        jacob.succeed("kubectl wait --for=condition=Ready pod/work-dan pod/work-judah --timeout=180s")
        remote_ip = jacob.succeed("kubectl get pod work-judah -o jsonpath='{.status.podIP}'").strip()
        jacob.wait_until_succeeds(f"kubectl exec work-dan -- wget -qO- http://{remote_ip}:8080 | grep worker-ok")
        jacob.succeed("kubectl create configmap persisted --from-literal=value=survives-reboot")

    with subtest("agent restart preserves workload and existing host service"):
        dan.succeed("systemctl restart k3s")
        jacob.wait_until_succeeds("kubectl wait --for=condition=Ready node/dan pod/work-dan --timeout=20s", timeout=180)
        for vm in [jacob, dan, judah]:
            assert vm.succeed("systemctl show existing-service -p MainPID --value").strip() == sentinel[vm.name]

    with subtest("server cold reboot restores encrypted database and identity"):
        uid = jacob.succeed("kubectl get node jacob -o jsonpath='{.metadata.uid}'").strip()
        jacob.reboot()
        jacob.wait_for_unit("k3s.service", timeout=300)
        jacob.wait_until_succeeds("kubectl wait --for=condition=Ready node/jacob node/dan node/judah --timeout=20s", timeout=300)
        assert jacob.succeed("kubectl get node jacob -o jsonpath='{.metadata.uid}'").strip() == uid
        assert jacob.succeed("kubectl get configmap persisted -o jsonpath='{.data.value}'").strip() == "survives-reboot"
        jacob.succeed("kubectl exec work-dan -- cat /tmp/www/index.html | grep worker-ok")

    evidence = {"scope": "isolated-x86_64-nixos-vm-test-not-live-fleet", "roles": {"jacob": "server", "dan": "agent", "judah": "agent"},
                "disabled": True, "missingToken": True, "wrongToken": True, "lockedState": True,
                "peerFirewall": True, "workerPods": True, "crossNodePodNetwork": True,
                "agentRestart": True, "encryptedServerReboot": True, "existingServicePreserved": True}
    Path("/tmp/k3s-evidence.json").write_text(json.dumps(evidence, indent=2))
    import shutil
    shutil.copy("/tmp/k3s-evidence.json", "${placeholder "out"}/k3s-evidence.json")
  '';
}
