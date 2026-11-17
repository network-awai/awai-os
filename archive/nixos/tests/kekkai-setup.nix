{ nixpkgs, system ? "x86_64-linux" }:
let
  pkgs = import nixpkgs { inherit system; };
  runtime = import ../kekkai-runtime.nix { inherit pkgs; };
  peerScript = pkgs.runCommand "kekkai-peer-test" {} ''
    mkdir -p $out/tests
    cp ${./kekkai-peer.mjs} $out/tests/kekkai-peer.mjs
    cp ${../kekkai-setup-client.mjs} $out/kekkai-setup-client.mjs
  '';
  control = pkgs.writeText "remote-control.mjs" ''
    import {control} from '/etc/murakumo/remote-access.mjs';
    const action=process.argv[2];
    let value={action};
    if(action==='approve-ssh'||action==='approve') {const info=await control({action:'info'});value={...value,...info.ssh};}
    console.log(JSON.stringify(await control(value)));
  '';
in pkgs.testers.runNixOSTest {
  name = "murakumo-kekkai-setup";
  globalTimeout = 600;
  nodes.node = { ... }: {
    imports = [ ../remote-access.nix ];
    services.murakumoRemote.enable = true;
    virtualisation.memorySize = 1024;
    environment.systemPackages = [ pkgs.nodejs_22 ];
    system.stateVersion = "26.05";
  };
  nodes.peer = { ... }: {
    virtualisation.memorySize = 1024;
    environment.systemPackages = [ pkgs.nodejs_22 pkgs.openssh pkgs.curl pkgs.iptables ];
    system.stateVersion = "26.05";
    # Kekkai uses a dynamically allocated UDP source port on the manager.
    networking.firewall.enable = false;
  };
  testScript = ''
    import json, os, shlex, hashlib, base64, re
    start_all()
    node.wait_for_unit("murakumo-remote.service")
    node.wait_until_succeeds("test -S /run/murakumo-remote/control.sock", timeout=90)
    peer.wait_for_unit("network.target")
    ctl = "node ${control} "
    pin = json.loads(node.succeed(ctl + "info"))["certificate"]
    opened = json.loads(node.succeed(ctl + "open"))
    peer.succeed("printf '%s' " + shlex.quote(opened["code"]) + " > /tmp/code")
    peer.succeed("node --input-type=module -e " + shlex.quote("import {pinnedRequest} from '${../kekkai-setup-client.mjs}'; try {await pinnedRequest('https://192.168.1.1:8443','0'.repeat(64),'/pair',{code:'" + opened["code"] + "',name:'wrong-pin'}); process.exit(1)} catch(e) {if(!e.message.includes('fingerprint')) throw e;}"))
    assert json.loads(node.succeed(ctl + "info"))["window"]["attempts"] == 0, "code sent before pin validation"
    node.succeed("test ! -e /etc/ssh/authorized_keys.d/murakumo-admin")
    command = "node ${peerScript}/tests/kekkai-peer.mjs https://192.168.1.1:8443 " + shlex.quote(pin) + " ${runtime}"
    peer.succeed("iptables -A OUTPUT -d 192.168.1.1 -p tcp --dport 22 -j REJECT")
    peer.succeed(command + " > /tmp/ssh-result 2>&1 & echo $! > /tmp/client-pid")
    try:
        node.wait_until_succeeds(ctl + "info | grep -q 'Mac'", timeout=60)
    except Exception:
        print(peer.succeed("cat /tmp/ssh-result"))
        raise
    node.wait_until_succeeds(ctl + "info | grep -q kekkaiFingerprint", timeout=60)
    assert not node.succeed("systemctl is-active sshd || true").strip() == "active"
    # Pin the real VM's SSH host key to its independently pinned overlay authority.
    # publish occurs only on approval, so delay the client profile read until known_hosts exists.
    peer.succeed("kill -STOP $(cat /tmp/client-pid)")
    node.succeed(ctl + "approve")
    info = json.loads(node.succeed("cat /var/lib/murakumo-remote/kekkai/identity.edn >/dev/null; " + ctl + "info"))
    # Public authority is available through the authenticated profile; read only that field.
    authority_match = re.search(r':netmap-authority-spki-b64 "([^"]+)"', node.succeed("cat /var/lib/murakumo-remote/kekkai/node.edn"))
    assert authority_match is not None
    authority = authority_match.group(1)
    digest = hashlib.sha256(base64.b64decode(authority)).hexdigest()[:16]
    alias = "murakumo-setup-" + "-".join(digest[i:i+4] for i in range(0,16,4))
    hostkey = node.succeed("cat /etc/ssh/ssh_host_ed25519_key.pub").strip()
    peer.succeed("printf '%s\\n' " + shlex.quote(alias + " " + hostkey) + " > /tmp/known_hosts")
    peer.succeed("kill -CONT $(cat /tmp/client-pid)")
    try:
        peer.wait_until_succeeds("grep -q KEKKAI-SSH-OK /tmp/ssh-result", timeout=90)
    except Exception:
        print(peer.succeed("cat /tmp/ssh-result"))
        print(node.succeed("journalctl -u murakumo-kekkai --no-pager"))
        raise
    assert "murakumo-admin" in peer.succeed("cat /tmp/ssh-result")
    node.succeed("test ! -e /var/lib/murakumo/account-link.json")
    node.succeed("test $(stat -c %a /var/lib/murakumo-remote/kekkai/identity.edn) = 600")
    node.shutdown()
    node.start()
    node.wait_for_unit("murakumo-kekkai.service")
    node.wait_for_unit("sshd.service")
    profile = peer.succeed("find /root/.kekkai -name profile.json -print -quit").strip()
    clientroot = os.path.dirname(profile)
    reconnect = "node ${runtime}/engine/cli.js --classpath ${runtime}/src ${runtime}/bootstrap.cljk client " + shlex.quote(clientroot) + " " + shlex.quote(profile) + " -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/tmp/known_hosts 'echo KEKKAI-REBOOT-OK'"
    peer.succeed(reconnect + " > /tmp/reconnect 2>&1 &")
    peer.wait_until_succeeds("grep -q KEKKAI-REBOOT-OK /tmp/reconnect", timeout=90)
    node.succeed(ctl + "revoke-ssh")
    node.succeed("test ! -e /etc/ssh/authorized_keys.d/murakumo-admin; test ! -e /var/lib/murakumo-remote/kekkai/node.edn")
    assert node.succeed("systemctl is-active murakumo-kekkai || true").strip() == "inactive"
    peer.fail("timeout 45 " + reconnect + " > /tmp/revoked 2>&1")
    assert "KEKKAI-REBOOT-OK" not in peer.succeed("cat /tmp/revoked")
    with open(os.path.join(os.environ['out'], 'kekkai-ssh.json'),'w') as f:
        json.dump({'schema':'murakumo.kekkai-ssh-vm.v1','prePasskey':True,'tlsPin':True,'twoKeyApproval':True,'singleApproval':True,'realOverlaySSH':True,'directLANBlocked':True,'reboot':True,'revoked':True},f)
  '';
}
