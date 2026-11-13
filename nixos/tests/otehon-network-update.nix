{ pkgs ? import (import ../../ci/nixpkgs.nix) { system = "x86_64-linux"; } }:
let
  fixtures = ../otehon/fixtures;
in pkgs.testers.runNixOSTest {
  name = "otehon-https-desktop-upgrade-state";
  node.pkgsReadOnly = false;
  nodes.machine = { config, lib, extendModules, nodes, ... }: {
    imports = [ ../otehon/desktop.nix ];
    nixpkgs.hostPlatform = lib.mkForce "x86_64-linux";
    networking.hostName = lib.mkForce "otehon-update-client";
    networking.extraHosts = "${nodes.publisher.networking.primaryIPAddress} publisher.test";
    otehon.headless = true;
    otehon.update = {
      enable = true; baseVersion = 1;
      publicKey = fixtures + /update/test-manifest.pub;
      cacheKey = fixtures + /update/test-cache.pub;
      network = {
        enable = true; feedUrl = "https://publisher.test/feed";
        cohort = "stable"; automaticReboot = true;
        maintenanceHours = lib.range 0 23;
        caBundle = fixtures + /update-network/test-tls.pem;
        interval = "10s";
        minimumFreeBytes = 128 * 1024 * 1024;
        maxDownloadBytes = 4 * 1024 * 1024 * 1024;
        maxImportBytes = 8 * 1024 * 1024 * 1024;
      };
    };
    # Update/state qualification does not execute inference or media kernels.
    systemd.services.otehon-manimani-llm.enable = lib.mkForce false;
    systemd.services.otehon-manimani.enable = lib.mkForce false;
    systemd.services.otehon-media.enable = lib.mkForce false;
    systemd.timers.otehon-update-poll.timerConfig = { OnBootSec = lib.mkForce "30s"; RandomizedDelaySec = lib.mkForce "0"; };
    virtualisation = { useBootLoader = true; useEFIBoot = true; diskSize = 16384; memorySize = 3072; cores = 2; };
    boot.loader.efi.canTouchEfiVariables = lib.mkForce true;
    boot.loader.timeout = lib.mkForce 1;
    fileSystems."/boot".device = lib.mkForce "/dev/vda1";
    environment.systemPackages = [ pkgs.nodejs pkgs.curl pkgs.jq ];
    environment.etc."ota-profile-check.mjs".source = ../otehon/update-profile-check.mjs;
    environment.etc."ota-generation".text = "a";
    system.build.otaGood = (extendModules { modules = [{ environment.etc."ota-generation".text = lib.mkForce "b"; system.image.version = lib.mkForce "0.7.1-update-check"; }]; }).config.system.build.toplevel;
    system.build.otaBad = (extendModules { modules = [{
      environment.etc."ota-generation".text = lib.mkForce "c";
      system.image.version = lib.mkForce "0.7.2-update-check";
      systemd.services.otehon-broken = { wantedBy = [ "multi-user.target" ]; serviceConfig = { Type = "oneshot"; ExecStart = "${pkgs.coreutils}/bin/false"; }; };
    }]; }).config.system.build.toplevel;
  };
  nodes.publisher = { nodes, ... }: {
    system.stateVersion = "26.05";
    environment.systemPackages = [ pkgs.minisign pkgs.jq pkgs.python3 ];
    environment.etc."ota-candidates.json".text = builtins.toJSON {
      good = "${nodes.machine.system.build.otaGood}";
      bad = "${nodes.machine.system.build.otaBad}";
      stateContract = "chromium-${pkgs.chromium.version}-otehon-origin-v2";
    };
    services.nix-serve = { enable = true; secretKeyFile = "${fixtures + /update/test-cache.key}"; };
    services.nginx = {
      enable = true;
      virtualHosts."publisher.test" = {
        forceSSL = true; sslCertificate = fixtures + /update-network/test-tls.pem; sslCertificateKey = fixtures + /update-network/test-tls.key;
        locations."/feed/cache/".proxyPass = "http://127.0.0.1:5000/";
        locations."/feed/".alias = "/var/lib/update-feed/";
      };
    };
    networking.firewall.allowedTCPPorts = [ 443 ];
    systemd.tmpfiles.rules = [ "d /var/lib/update-feed 0755 root root -" ];
    environment.etc."test-manifest.key".source = fixtures + /update/test-manifest.key;
    virtualisation.memorySize = 1024;
  };
  testScript = ''
    import json, shlex, time, select, types
    # Pinned test-driver connect() checks each recv(1024) separately. UEFI
    # output can split its marker across packets and hang forever. Preserve
    # the same handshake, with buffering and a bounded test-only wait.
    def bounded_connect(self):
        if self.connected:
            return
        self.start()
        end = time.monotonic() + 180
        received = b""
        while b"Spawning backdoor root shell..." not in received:
            if time.monotonic() >= end:
                raise TimeoutError("test driver backdoor handshake")
            if not select.select([self.shell], [], [], 1)[0]:
                continue
            data = self.shell.recv(1024)
            if not data:
                raise RuntimeError("test driver backdoor disconnected")
            received = (received + data)[-4096:]
        self.connected = True
        self.log("connected to guest root shell (buffered UEFI handshake)")
    for node in [publisher, machine]:
        node.connect = types.MethodType(bounded_connect, node)
    publisher.start()
    machine.start(allow_reboot=True)
    publisher.wait_for_unit("nginx.service",timeout=120)
    publisher.wait_for_unit("nix-serve.service",timeout=120)
    machine.wait_for_unit("otehon-headless-shell.service",timeout=180)
    machine.wait_for_unit("otehon-update-poll.timer",timeout=120)
    machine.wait_until_succeeds("curl -f http://127.0.0.1:9222/json/list | grep webSocketDebuggerUrl")
    machine.succeed("node /etc/ota-profile-check.mjs seed")
    machine.succeed("printf 'owner-file-stays\n' >/home/otehon/ota-owner-file; sync")
    before = machine.succeed("sha256sum /home/otehon/ota-owner-file /etc/machine-id")
    candidates = json.loads(publisher.succeed("cat /etc/ota-candidates.json"))
    def publish(version, target, cohorts, **overrides):
        now = int(time.time())
        data = {"schema":"awai.otehon.release.v1","version":version,"system":candidates[target],"channel":"stable","cohorts":cohorts,"architecture":"x86_64","stateContract":candidates["stateContract"],"issuedAt":now-60,"expiresAt":now+3600}
        data.update(overrides)
        publisher.succeed("printf '%s' " + shlex.quote(json.dumps(data)) + " >/var/lib/update-feed/manifest.json")
        publisher.succeed("minisign -S -q -W -s /etc/test-manifest.key -m /var/lib/update-feed/manifest.json -x /var/lib/update-feed/manifest.json.minisig; chmod 644 /var/lib/update-feed/*")
    machine.succeed("systemctl stop otehon-update-poll.timer")
    def unchanged():
        assert machine.succeed("cat /etc/ota-generation").strip()=="a"
        assert machine.succeed("sha256sum /home/otehon/ota-owner-file /etc/machine-id")==before
        machine.succeed("test ! -e /var/lib/otehon-update/pending.json")
    def poll_refuses(reason):
        machine.succeed("systemctl reset-failed otehon-update-poll.service")
        machine.fail("systemctl start otehon-update-poll.service")
        machine.succeed("journalctl -u otehon-update-poll -n 12 --no-pager | grep " + shlex.quote(reason))
        unchanged()
    publish(2,"good",["stable"])
    publisher.succeed("printf 'tampered' >>/var/lib/update-feed/manifest.json")
    poll_refuses("manifest-admission")
    publish(2,"good",["stable"],expiresAt=int(time.time())-1)
    poll_refuses("release-time")
    publish(2,"good",["stable"],stateContract="unqualified-browser-schema")
    poll_refuses("state-contract")
    publish(2,"good",["stable"])
    publisher.succeed("systemctl stop nginx.service")
    poll_refuses("URLError")
    publisher.succeed("systemctl start nginx.service")
    machine.succeed("systemctl reset-failed otehon-update-poll.service")
    publish(2,"good",["canary"])
    machine.succeed("systemctl start otehon-update-poll.timer")
    machine.wait_until_succeeds("journalctl -u otehon-update-poll --no-pager | grep '\"reason\": \"cohort\"'",timeout=120)
    assert machine.succeed("cat /etc/ota-generation").strip()=="a"
    assert machine.succeed("sha256sum /home/otehon/ota-owner-file /etc/machine-id")==before
    # Explicit signed promotion, not self-reported automatic fleet authority.
    publish(2,"good",["canary","stable"])
    machine.wait_until_succeeds("test $(cat /etc/ota-generation) = b",timeout=600)
    machine.wait_until_succeeds("test $(cat /var/lib/otehon-update/version) = 2",timeout=180)
    machine.wait_until_succeeds("node /etc/ota-profile-check.mjs read | grep CHROMIUM_STATE_OK")
    assert machine.succeed("sha256sum /home/otehon/ota-owner-file /etc/machine-id")==before
    machine.reboot()
    machine.wait_until_succeeds("node /etc/ota-profile-check.mjs read | grep CHROMIUM_STATE_OK",timeout=180)
    publish(3,"bad",["canary","stable"])
    machine.wait_until_succeeds("grep -qx 3 /var/lib/otehon-update/blocked",timeout=600)
    machine.wait_until_succeeds("test $(cat /etc/ota-generation) = b",timeout=180)
    machine.wait_until_succeeds("node /etc/ota-profile-check.mjs read | grep CHROMIUM_STATE_OK")
    assert machine.succeed("sha256sum /home/otehon/ota-owner-file /etc/machine-id")==before
    machine.copy_from_vm("/var/lib/otehon-update/version","confirmed-version")
    machine.succeed("journalctl -u otehon-update-poll -u otehon-update-settle >/var/lib/otehon-update/test-journal.txt")
    machine.copy_from_vm("/var/lib/otehon-update/test-journal.txt","update-journal.txt")
  '';
}
