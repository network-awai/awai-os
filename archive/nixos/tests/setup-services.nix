{ nixpkgs, system ? "x86_64-linux" }:
let
  pkgs = import nixpkgs { inherit system; };
  production = import (nixpkgs + "/nixos") {
    configuration = ../offline-uefi.nix;
    inherit system;
  };
  launch = production.config.systemd.services.murakumo-account-link.serviceConfig.ExecStart;
in pkgs.testers.runNixOSTest {
  name = "murakumo-setup-services";
  globalTimeout = 900;
  enableOCR = true;
  nodes.node = { lib, ... }: {
    imports = [ ../offline-base.nix ];
    system.stateVersion = "26.05";
    virtualisation.memorySize = 3072;
    virtualisation.cores = 2;
    virtualisation.graphics = true;
    # Run the exact production launch command and the probe as children of
    # one service process. ExecStartPost would acquire tty-force again and
    # steal the UI's controlling terminal. PATH and the filesystem namespace
    # remain those of the production unit. Extend the timer to prevent a real
    # production update fetch during an otherwise offline test.
    systemd.timers.aiueos-update.timerConfig.OnBootSec = lib.mkForce "1h";
    systemd.services.murakumo-account-link.serviceConfig.ExecStart = lib.mkForce
      (pkgs.writeShellScript "probe-production-setup-unit" ''
        ${pkgs.nodejs_22}/bin/node ${./setup-services.mjs} &
        exec ${launch}
      '');
    systemd.services.murakumo-account-link.after = [ "murakumo-remote.service" ];
    systemd.services.murakumo-account-link.requires = [ "murakumo-remote.service" ];
  };
  nodes.peer = { ... }: {
    virtualisation.memorySize = 384;
    virtualisation.cores = 1;
    environment.systemPackages = [ pkgs.curl pkgs.openssh ];
    system.stateVersion = "26.05";
  };
  testScript = ''
    gui_keys = []
    def press(key):
        gui_keys.append(key)
        node.send_key(key, delay=0.2)
    start_all()
    node.wait_for_unit("NetworkManager.service")
    node.wait_for_unit("murakumo-remote.service")
    try:
        node.wait_for_unit("murakumo-account-link.service", timeout=180)
        node.wait_until_succeeds("test -s /var/lib/murakumo/ci-setup-result.json || test -s /var/lib/murakumo/ci-probe-failure.json", timeout=180)
        node.succeed("test ! -s /var/lib/murakumo/ci-probe-failure.json")
    except Exception:
        print(node.succeed("cat /var/lib/murakumo/ci-probe-failure.json || true"))
        raise
    node.succeed("test -s /var/lib/murakumo/ci-setup-result.json")
    assert node.succeed("systemctl show murakumo-account-link -p ProtectSystem --value").strip() == "strict"
    assert "aiueos-update" in node.succeed("systemctl show murakumo-account-link -p StateDirectory --value")
    node.succeed("systemctl is-active aiueos-update.timer")
    peer.wait_for_unit("network.target")
    peer.wait_until_succeeds("ip -4 addr show eth1 | grep -q 192.168.1.2", timeout=60)
    peer.wait_until_succeeds("curl -fsk --connect-timeout 2 https://192.168.1.1:8443/ >/dev/null", timeout=30)
    assert peer.succeed("curl -sk -o /dev/null -w '%{http_code}' https://192.168.1.1:8443/").strip() == "200"
    assert peer.succeed("curl -sk -X POST -d '{}' -o /dev/null -w '%{http_code}' https://192.168.1.1:8443/status").strip() == "403"
    node.succeed("test $(stat -c %a /var/lib/aiueos-update) = 700")
    before = node.succeed("sha256sum /var/lib/aiueos-update/config.json /var/lib/aiueos-update/journal.json /var/lib/murakumo-remote/tls.crt")
    node.copy_from_machine("/var/lib/murakumo/ci-setup-result.json", "first-boot")
    try:
        node.wait_until_succeeds("test -n \"$(find /run/murakumo-ui -name ui.sock -print -quit)\"", timeout=90)
        node.wait_for_text("Choose your language", timeout=90)
        node.screenshot("language-selection")
        press("tab")
        press("tab")
        press("ret")
        node.wait_until_succeeds("test -n \"$(find /run/murakumo-ui -name started -print -quit)\"", timeout=30)
        node.wait_until_succeeds("grep -qx en /var/lib/murakumo/ui-language", timeout=30)
        node.wait_for_text("Choose how to use this device", timeout=60)
    except Exception:
        print(node.succeed("find /run/murakumo-ui -name '*.log' -exec cat {} +"))
        raise
    node.screenshot("setup-first-boot")
    # Use real GTK keyboard actions: no IPC injection or mocked menu here.
    press("ret")
    node.wait_for_text("completed locally", timeout=60)
    try:
        node.wait_for_text("Node details", timeout=30)
        node.wait_for_text("NixOS updates", timeout=30)
    except Exception:
        print("MURAKUMO-UX-MENU-FAIL: essential choices are clipped")
        raise
    node.screenshot("setup-local-complete")
    press("tab")
    press("tab")
    press("ret")
    node.wait_for_text("Normal checks run", timeout=60)
    press("esc")
    try:
        node.wait_for_text("completed locally", timeout=30)
    except Exception:
        print("MURAKUMO-UX-ESC-FAIL: update screen did not return to local completion")
        raise
    node.screenshot("setup-escape-return")
    local_decisions, local_keys = gui_keys.count("ret"), len(gui_keys)
    # The actual GTK screen discovers requests without Refresh or IPC approval.
    import json, shlex
    press("ret")
    node.wait_for_text("Enter the code", timeout=60)
    peer.succeed("ssh-keygen -q -t ed25519 -N \"\" -f /tmp/gui-key")
    public_key = peer.succeed("cat /tmp/gui-key.pub").strip()
    info_command = "node --input-type=module -e " + shlex.quote("import {control} from '/etc/murakumo/remote-access.mjs'; console.log(JSON.stringify(await control({action:'info'})))")
    info = json.loads(node.succeed(info_command))
    body = json.dumps({'code':info['window']['code'],'name':'GUI peer','key':public_key})
    paired = json.loads(peer.succeed("curl -fsk https://192.168.1.1:8443/pair -H 'Content-Type: application/json' -d " + shlex.quote(body)))
    node.wait_for_text("Approve this computer", timeout=30)
    node.wait_for_text("GUI peer", timeout=30)
    node.screenshot("remote-one-approval")
    press("ret")
    node.wait_for_text("SSH is ready", timeout=60)
    peer.wait_until_succeeds("curl -fsk https://192.168.1.1:8443/poll -H " + shlex.quote("Authorization: Bearer " + paired['ticket']) + " -H 'Content-Type: application/json' -d '{}' | grep -q '\"sshReady\":true'", timeout=30)
    host_key = node.succeed("cat /etc/ssh/ssh_host_ed25519_key.pub").strip()
    peer.succeed("printf '%s\\n' " + shlex.quote('192.168.1.1 ' + host_key) + " > /tmp/gui-known-hosts")
    assert peer.succeed("ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/tmp/gui-known-hosts -i /tmp/gui-key murakumo-admin@192.168.1.1 id -un").strip() == 'murakumo-admin'
    node.screenshot("remote-ready")
    press("esc")
    node.wait_for_text("completed locally", timeout=30)

    node.succeed("test -s /var/lib/murakumo/local-setup.json")
    node.succeed("test ! -s /var/lib/murakumo/account-link.json")
    import json, os
    with open(os.path.join(os.environ["out"], "journey-gui.json"), "w") as report:
        json.dump({"languageSelected": True, "completed": True, "accountNotClaimed": True,
                   "escapeReturned": True, "actionsVisible": True, "remoteAutoRefresh": True, "singlePhysicalApproval": True, "actualSSH": True, "decisions": local_decisions, "keys": local_keys}, report)
    node.shutdown()
    node.start()
    node.wait_for_unit("murakumo-account-link.service", timeout=180)
    node.wait_until_succeeds("grep -q '\"savedConsent\":true' /var/lib/murakumo/ci-setup-result.json", timeout=180)
    node.succeed("test ! -s /var/lib/murakumo/ci-probe-failure.json")
    node.succeed("systemctl is-active aiueos-update.timer")
    after = node.succeed("sha256sum /var/lib/aiueos-update/config.json /var/lib/aiueos-update/journal.json /var/lib/murakumo-remote/tls.crt")
    assert before == after, "consent, anti-replay history or TLS identity changed on reboot"
    node.copy_from_machine("/var/lib/murakumo/ci-setup-result.json", "second-boot")
    print("MURAKUMO-VM-PASS: service-path state-directory timer pairing reboot")
  '';
}
