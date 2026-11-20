#!/usr/bin/env python3
"""ADR 0027 V5 (AWAI-3141): one real owner order through every part, on real hosts.

  buyer   this Mac: EN devnet node, sponsor key, the bot's signer (owner key enrolled)
  owner   an AOSP emulator this run owns: Sanka order and acceptance cards (android/sanka)
  provider PROVIDER_HOST (benjamin): llama-server, the provider desk and the provider operator's key

Flow: the owner approves the order on the card, the signer reserves, the provider operator registers
the order, the buyer calls the desk through an SSH tunnel, the independent verifier checks the
receipt, the owner accepts the real answer on the card, the signer proposes the settlement, the
provider operator counter-signs on its own host, the node finalizes, the node restarts and reads
back, and signer, ledger and journal reconcile. A second order is approved and reserved, the desk is
stopped, the call fails and the reservation is released without payment.

The prompt is the owner's own request, chosen by the owner on 2026-11-18. Evidence keeps hashes of
the prompt and the answer, never their text. value-class devnet; nothing here is money or revenue.

usage: python3 dapps/sanka/test/live_v5.py --serial emulator-NNNN --apk APK --host node@benjamin \
         --remote-dir DIR --engine-dir DIR --out DIR
"""
import argparse, base64, hashlib, json, os, re, secrets, socket, subprocess, sys, time, urllib.error, urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
SANKA = os.path.join(ROOT, "dapps/sanka")
EN = os.path.join(ROOT, "dapps/en-devnet")
PKG = "network.awai.sanka"
NODE_PORT = 18793
NODE = f"http://127.0.0.1:{NODE_PORT}"
CHAIN = "awai-en-devnet/adr0027-v5"
PROMPT = "Awai OS を一文で紹介する日本語のキャッチコピーを 3 案出して"
MODEL = {"revision": "23749fefcc72300e3a2ad315e1317431b06b590a",
         "digest": "sha256:9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031"}
ENGINE_REV = "9581154a2250cc9e6948e4c2a2fc4b4e19d1a57e"


def canonical(v):
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def cid(data):
    return "b" + base64.b32encode(bytes([1, 0xa9, 2, 0x12, 0x20]) + hashlib.sha256(data).digest()).decode().lower().rstrip("=")


def sha(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode("utf-8")).hexdigest()


class Run:
    def __init__(self, a):
        self.a, self.out, self.results = a, a.out, []
        self.adb = [os.path.expanduser("~/Library/Android/sdk/platform-tools/adb"), "-s", a.serial]

    def check(self, name, ok, detail=None):
        self.results.append({"check": name, "passed": bool(ok), "detail": None if ok else detail})
        print(("PASS " if ok else "FAIL ") + name + ("" if ok or detail is None else f"  {detail}"), flush=True)
        return ok

    # -- provider host --
    def ssh(self, command, stdin=None, timeout=300):
        r = subprocess.run(["ssh", "-o", "BatchMode=yes", self.a.host, "export PATH=/opt/homebrew/bin:$PATH; " + command],
                           input=stdin, capture_output=True, timeout=timeout)
        return r.stdout.decode("utf-8", "replace")

    def remote_json(self, command, stdin=None):
        text = self.ssh(command, stdin).strip().splitlines()
        try:
            return json.loads(text[-1])
        except Exception:
            return {"crash": text[-3:] if text else []}

    # -- device --
    def sh(self, *args, stdin=None):
        return subprocess.run(self.adb + ["shell", *args], input=stdin, capture_output=True, timeout=120).stdout

    def put(self, name, data):
        self.sh(f"run-as {PKG} sh -c 'cat > files/{name}'", stdin=data)

    def card(self, kind, data, answer=None):
        self.sh("run-as", PKG, "rm", "-f", "files/result.json")
        self.put("request.bin", data)
        if answer is not None:
            self.put("answer.json", answer)
        self.put("request.kind", kind.encode())
        self.sh("am", "force-stop", PKG)
        self.sh("am", "start", "-W", "-n", f"{PKG}/.MainActivity")
        time.sleep(1.5)

    def ui(self):
        self.sh("uiautomator", "dump", "/sdcard/sanka-ui.xml")
        xml = self.sh("cat", "/sdcard/sanka-ui.xml").decode("utf-8", "replace")
        return [(n.get("text") or "", n.get("bounds") or "", n.get("class") or "")
                for n in ET.fromstring(xml[xml.index("<?xml"):]).iter("node")]

    def tap(self, label):
        for t, b, c in self.ui():
            if t == label and c.endswith("Button"):
                x1, y1, x2, y2 = map(int, re.findall(r"\d+", b))
                self.sh("input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
                time.sleep(1.5)
                return True
        return False

    def result(self, name):
        data = self.sh("run-as", PKG, "cat", "files/result.json")
        return self.save(name, data)

    # -- local signer and node --
    def n(self, *args, stdin=None):
        r = subprocess.run(["nbb", "-cp", "src", *args], cwd=EN, input=stdin, capture_output=True, timeout=120)
        lines = r.stdout.decode().strip().splitlines()
        try:
            return json.loads(lines[-1])
        except Exception:
            return {"crash": r.stderr.decode()[-300:]}

    def raw(self, *args, stdin=None):
        return subprocess.run(["nbb", "-cp", "src", *args], cwd=EN, input=stdin, capture_output=True, timeout=120).stdout

    def save(self, name, value):
        path = os.path.join(self.out, name)
        open(path, "wb").write(value if isinstance(value, bytes) else canonical(value))
        return path

    def start_node(self):
        self.node_proc = subprocess.Popen(["nbb", "-cp", "src", "host/node.cljs", "serve", os.path.join(self.out, "ledger"), str(NODE_PORT)],
                                          cwd=EN, stdout=open(os.path.join(self.out, "node.log"), "a"), stderr=subprocess.STDOUT)
        for _ in range(40):
            if self.http("GET", NODE + "/v1/head")[0] == 200:
                return
            time.sleep(0.5)
        raise SystemExit("node did not start")

    def stop_node(self):
        subprocess.run(["pkill", "-f", f"host/node.cljs serve {os.path.join(self.out, 'ledger')} {NODE_PORT}"])
        for _ in range(20):
            if self.http("GET", NODE + "/v1/head")[0] != 200:
                return
            time.sleep(0.5)
        raise SystemExit("node did not stop")

    def http(self, method, url, body=None, key=None):
        req = urllib.request.Request(url, data=body, method=method)
        if key:
            req.add_header("Authorization", "Bearer " + key)
        if body is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=600) as res:
                return res.status, dict(res.headers), res.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()
        except OSError as e:
            return 0, {}, str(e).encode()

    def order(self, nonce):
        return {"kind": "awai.order/1", "work-kind": "compute", "buyer": self.bot, "provider": self.provider,
                "node": self.desk_node, "asset": "native/engi/EN", "amount": "1", "value-class": "devnet",
                "model": MODEL, "max-tokens": 160, "expires-at": int(time.time()) + 1800,
                "data-categories": ["prompt"], "policy": "sha256:" + "0" * 64, "demand": "owner-internal", "nonce": nonce}

    # -- the run --
    def setup_provider(self):
        a, R = self.a, self.a.remote_dir
        self.ssh(f"test ! -e {R} && mkdir -p {R}")
        tar = subprocess.run(["tar", "-cf", "-", "-C", ROOT, "dapps/sanka/src", "dapps/sanka/provider", "dapps/en-devnet/src", "dapps/en-devnet/host"],
                             capture_output=True).stdout
        self.ssh(f"tar -xf - -C {R}", stdin=tar)
        busy = self.ssh("lsof -nP -iTCP:18787 -iTCP:18788 -sTCP:LISTEN | tail -n +2 | wc -l").strip()
        if busy != "0":
            raise SystemExit("provider ports busy")
        self.provider = self.remote_json(f"cd {R}/dapps/en-devnet && nbb -cp src host/signer.cljs keygen {R}/provider.pem")["did"]
        E = a.engine_dir
        self.ssh(f"cd {R} && nohup {E}/bin/llama-server -m {E}/models/Qwen3-0.6B-Q8_0.gguf --host 127.0.0.1 --port 18787 "
                 f"-c 4096 -t 4 --no-webui > {R}/llama.log 2>&1 & for i in $(seq 1 90); do curl -fs http://127.0.0.1:18787/health >/dev/null && break; sleep 1; done")
        init = self.remote_json(f"cd {R}/dapps/sanka && nbb -cp src provider/desk.cljs init {R}/desk-root {self.provider} "
                                f"{E}/bin/llama-server {ENGINE_REV} {E}/models/Qwen3-0.6B-Q8_0.gguf {MODEL['revision']} http://127.0.0.1:18787")
        self.desk_node = init.get("node")
        ok = init.get("model") == MODEL and init.get("provider") == self.provider
        self.check("the provider desk is initialised with the pinned model and the provider operator's key", ok, init)
        self.ssh(f"cd {R}/dapps/sanka && nohup nbb -cp src provider/desk.cljs serve {R}/desk-root 18788 > {R}/desk.log 2>&1 & sleep 7")
        self.tunnel_port = free_port()
        self.tunnel = subprocess.Popen(["ssh", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-N", "-L",
                                        f"127.0.0.1:{self.tunnel_port}:127.0.0.1:18788", a.host])
        time.sleep(3)

    def desk(self, method, path, body=None, key=None):
        return self.http(method, f"http://127.0.0.1:{self.tunnel_port}{path}", body, key)

    def go(self):
        a, o = self.a, self.out
        self.setup_provider()
        # Owner device and key.
        subprocess.run(self.adb + ["install", "-r", a.apk], check=True, capture_output=True)
        self.sh("run-as", PKG, "rm", "-f", "files/request.kind", "files/request.bin", "files/answer.json", "files/result.json")
        self.sh("am", "start", "-W", "-n", f"{PKG}/.MainActivity")
        time.sleep(1.5)
        owner = json.loads(self.sh("run-as", PKG, "cat", "files/owner.json"))
        # Buyer side: keys, node, funding, signer.
        dids = {r: self.n("host/signer.cljs", "keygen", os.path.join(o, r + ".pem"))["did"] for r in ["sponsor", "bot", "operator"]}
        self.bot = dids["bot"]
        self.n("host/node.cljs", "init", os.path.join(o, "ledger"), CHAIN, dids["operator"], dids["sponsor"], self.bot, self.provider)
        self.start_node()
        for i in (1, 2):
            tx = self.raw("host/signer.cljs", "funding", CHAIN, dids["sponsor"], self.bot, f"fund-{i}", secrets.token_hex(6), "600000")
            tx = self.raw("host/signer.cljs", "sign", os.path.join(o, "sponsor.pem"), stdin=tx)
            tx = self.raw("host/signer.cljs", "sign", os.path.join(o, "bot.pem"), stdin=tx)
            self.n("host/signer.cljs", "submit", "-", NODE, stdin=tx)
        bs = os.path.join(o, "bot-signer")
        self.n("host/signer.cljs", "init", bs, os.path.join(o, "bot.pem"), CHAIN, "1", self.provider)
        self.check("the bot's signer enrolls the owner's device key", self.n("host/signer.cljs", "enroll", bs, owner["spki"]).get("enrolled") is True)

        # 1. The owner approves the real order.
        order = self.order("v5-" + secrets.token_hex(4))
        ob, oc = canonical(order), cid(canonical(order))
        self.card("order", ob)
        shown = [t for t, _, _ in self.ui()]
        self.check("the order card shows this order's provider, amount, value class and CID",
                   all(x in shown for x in [self.provider, "1 native/engi/EN", "devnet — no real value / 実際の価値なし", oc]))
        self.check("the owner taps Approve", self.tap("承認する · Approve"))
        r = self.n("host/signer.cljs", "reserve-approved", bs, NODE, self.save("order.json", ob), self.result("approval.json"))
        self.check("the signer reserves one unit for the approved order", r.get("state") == ":reserved", r)

        # 2. The provider serves it.
        key = secrets.token_urlsafe(32)
        reg = self.remote_json(f"cd {a.remote_dir}/dapps/sanka && nbb -cp src provider/desk.cljs register {a.remote_dir}/desk-root - {sha(key)}", stdin=ob)
        self.check("the provider operator registers the same order", reg.get("order") == oc, reg)
        request = json.dumps({"messages": [{"role": "user", "content": PROMPT + " /no_think"}], "temperature": 0.7, "seed": 7}).encode()
        started = time.time()
        status, headers, body = self.desk("POST", "/v1/chat/completions", request, key)
        elapsed = time.time() - started
        self.check("the desk answers through the tunnel", status == 200, status)
        reply = json.loads(body) if status == 200 else {}
        message = reply.get("choices", [{}])[0].get("message", {})
        answer_text = message.get("content", "")
        open(os.path.join(o, "answer.txt"), "w").write(answer_text)
        status, _, rbody = self.desk("GET", f"/v1/orders/{oc}/receipt", None, key)
        receipt = json.loads(rbody) if status == 200 else {}
        files = [self.save("v-order.json", ob), self.save("receipt.json", canonical(receipt)), self.save("request.bin", request),
                 self.save("reply.json", canonical(reply)), self.save("key.txt", key.encode())]
        v = subprocess.run(["basilisp", "run", "tools/verify_receipt.lpy", *files], cwd=SANKA, capture_output=True,
                           env={**os.environ, "PYTHONPATH": "src", "PYTHONDONTWRITEBYTECODE": "1"})
        verdict = json.loads(v.stdout.decode().strip().splitlines()[-1]) if v.stdout else {}
        os.remove(os.path.join(o, "key.txt"))
        if not self.check("the independent verifier accepts the real receipt", v.returncode == 0 and verdict.get("ok"), verdict):
            return self.finish(order=oc)

        # 3. The owner judges the real answer.
        rb, mb = canonical(receipt), canonical(message)
        self.card("acceptance", rb, canonical(dict(message, content=answer_text + "（改変）")))
        shown = [t for t, _, _ in self.ui()]
        self.check("a changed answer gets no buttons on the acceptance card", "受け入れる · Accept" not in shown)
        self.card("acceptance", rb, mb)
        shown = [t for t, _, _ in self.ui()]
        self.check("the acceptance card shows the real answer and its receipt", answer_text in shown and cid(rb) in shown)
        self.check("the owner taps Accept", self.tap("受け入れる · Accept"))
        tx = self.n("host/signer.cljs", "settle-accepted", bs, self.save("receipt-for-settle.json", rb), self.result("acceptance.json"), "600000")
        self.check("the signer proposes the settlement for the accepted receipt", tx.get("kind") == ":settlement" and tx.get("order") == oc, tx)
        signed = self.ssh(f"cd {a.remote_dir}/dapps/en-devnet && nbb -cp src host/signer.cljs sign {a.remote_dir}/provider.pem", stdin=canonical(tx)).encode()
        fin = self.n("host/signer.cljs", "submit", bs, NODE, stdin=signed)
        self.check("the provider operator counter-signs on its host and the node finalizes", fin.get("finalized") is True, fin)
        again = self.n("host/signer.cljs", "submit", "-", NODE, stdin=signed)
        self.check("the same settlement is not paid twice", again.get("cause") == ":duplicate-nonce", again)

        # 4. Restart and reconcile.
        head1 = self.http("GET", NODE + "/v1/head")[2]
        self.stop_node(); self.start_node()
        head2 = self.http("GET", NODE + "/v1/head")[2]
        self.check("after a restart the node reads back the same head", head1 == head2)
        rec = self.n("host/signer.cljs", "reconcile", bs, NODE)
        self.check("signer, ledger and journal reconcile", rec.get("match") is True, rec)

        # 5. The provider stops: no payment.
        order_b = self.order("v5-down-" + secrets.token_hex(4))
        bb_, bc = canonical(order_b), cid(canonical(order_b))
        self.card("order", bb_)
        self.tap("承認する · Approve")
        self.n("host/signer.cljs", "reserve-approved", bs, NODE, self.save("order-b.json", bb_), self.result("approval-b.json"))
        key_b = secrets.token_urlsafe(32)
        self.remote_json(f"cd {a.remote_dir}/dapps/sanka && nbb -cp src provider/desk.cljs register {a.remote_dir}/desk-root - {sha(key_b)}", stdin=bb_)
        self.ssh("pkill -f 'provider/desk.cljs serve " + a.remote_dir + "/desk-root'")
        time.sleep(2)
        status, _, _ = self.desk("POST", "/v1/chat/completions", request, key_b)
        self.check("with the desk stopped the order gets no answer", status != 200, status)
        before = json.loads(self.http("GET", NODE + "/v1/accounts/" + self.bot)[2]).get("balance")
        rel = self.n("host/signer.cljs", "release", bs, bc)
        after = json.loads(self.http("GET", NODE + "/v1/accounts/" + self.bot)[2]).get("balance")
        self.check("the reservation is released and nothing is paid", rel.get("released") is True and rel.get("paid") == 0 and before == after, rel)
        rec2 = self.n("host/signer.cljs", "reconcile", bs, NODE)
        self.check("signer, ledger and journal still reconcile", rec2.get("match") is True, rec2)

        journal = json.loads(self.http("GET", NODE + "/v1/journal")[2])
        return self.finish(order=oc, receipt=receipt, reply=reply, answer=answer_text, settlement=fin, journal=journal,
                           head=json.loads(head2), elapsed=elapsed, prompt=PROMPT)

    def finish(self, **kw):
        try:
            self.ssh(f"pkill -f 'provider/desk.cljs serve {self.a.remote_dir}/desk-root'; pkill -f '{self.a.engine_dir}/bin/llama-server'")
            self.tunnel.terminate()
            self.stop_node()
        except Exception:
            pass
        receipt = kw.get("receipt", {})
        return {
            "schema": "awai.sanka.v5-evidence/1", "issue": "AWAI-3141", "chain-id": CHAIN, "value-class": "devnet",
            "demand": "owner-internal", "demand-source": "owner chose this request on 2026-11-18",
            "prompt-sha256": sha(PROMPT), "answer-sha256": sha(kw.get("answer", "")), "answer-chars": len(kw.get("answer", "")),
            "order": kw.get("order"), "receipt": cid(canonical(receipt)) if receipt else None,
            "provider": getattr(self, "provider", None), "desk-node": getattr(self, "desk_node", None), "bot": getattr(self, "bot", None),
            "engine": receipt.get("engine"), "model": receipt.get("model"), "measured": receipt.get("measured"),
            "wall-seconds-through-tunnel": round(kw.get("elapsed", 0), 3),
            "settlement": kw.get("settlement"), "head": kw.get("head"), "journal": kw.get("journal"),
            "checks": self.results, "passed": sum(r["passed"] for r in self.results), "total": len(self.results)}


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def main():
    ap = argparse.ArgumentParser()
    for k in ["serial", "apk", "host", "remote-dir", "engine-dir", "out"]:
        ap.add_argument("--" + k, required=True)
    a = ap.parse_args()
    if os.path.exists(a.out):
        raise SystemExit("out exists")
    os.makedirs(a.out)
    ev = Run(a).go()
    json.dump(ev, open(os.path.join(a.out, "evidence.json"), "w"), indent=2, ensure_ascii=False)
    print(f"{ev['passed']} of {ev['total']} checks")
    sys.exit(0 if ev["passed"] == ev["total"] else 1)


if __name__ == "__main__":
    main()
