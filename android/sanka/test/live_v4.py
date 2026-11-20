#!/usr/bin/env python3
"""ADR 0027 V4 (AWAI-3123): the owner's native cards on an AOSP emulator gate the bot's signer.

Runs on one host with a disposable emulator that this run owns (pass its serial). It:
  * installs the Sanka APK, reads the owner's Keystore public key and enrolls it in the bot's signer,
  * starts an EN devnet node (dapps/en-devnet) and funds the bot with two units,
  * shows an order card, checks with a UI dump that the card shows the order's fields, taps Approve,
    and reserves only with that signed approval,
  * shows an acceptance card for a receipt and its answer, taps Accept, and settles only with that
    signed acceptance; the provider counter-signs and the node finalizes; signer, ledger and journal
    reconcile,
  * then tries to break it: no approval, a fake key's approval, an approval for another order, a
    denied order, no acceptance, an acceptance for another receipt, a rejected result (no payment),
    and an answer that does not match its receipt (no buttons).

The receipt is a fixture: its fields have the V2 shape but no provider desk made it. Binding a real
receipt is V5. Taps come from `adb shell input`, standing in for the owner's finger.

usage: python3 android/sanka/test/live_v4.py --serial emulator-5620 --apk APK --out DIR
"""
import argparse, base64, hashlib, json, os, re, subprocess, sys, time, xml.etree.ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
# SANKA_EN_DIR points the run at another copy of the signer, for the negative control only.
EN = os.environ.get("SANKA_EN_DIR", os.path.join(ROOT, "dapps/en-devnet"))
PKG = "network.awai.sanka"
PORT = 18792
NODE = f"http://127.0.0.1:{PORT}"
CHAIN = "awai-en-devnet/adr0027-v4"


def canonical(v):
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def cid(data):
    raw = bytes([0x01, 0xa9, 0x02, 0x12, 0x20]) + hashlib.sha256(data).digest()
    return "b" + base64.b32encode(raw).decode("ascii").lower().rstrip("=")


class Run:
    def __init__(self, a):
        self.a, self.out, self.results = a, a.out, []
        self.adb = [os.path.expanduser("~/Library/Android/sdk/platform-tools/adb"), "-s", a.serial]

    def check(self, name, ok, detail=None):
        self.results.append({"check": name, "passed": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + (f"  {detail}" if detail is not None and not ok else ""), flush=True)

    # -- device --
    def sh(self, *args, stdin=None):
        return subprocess.run(self.adb + ["shell", *args], input=stdin, capture_output=True, timeout=120).stdout

    def put(self, name, data):
        # One quoted string: adb shell joins its arguments, so an unquoted redirection would run
        # outside run-as and never reach the app's private files.
        self.sh(f"run-as {PKG} sh -c 'cat > files/{name}'", stdin=data)

    def get(self, name):
        return self.sh("run-as", PKG, "cat", f"files/{name}")

    def launch(self):
        self.sh("am", "force-stop", PKG)
        self.sh("am", "start", "-W", "-n", f"{PKG}/.MainActivity")
        time.sleep(1.5)

    def ui(self):
        self.sh("uiautomator", "dump", "/sdcard/sanka-ui.xml")
        xml = self.sh("cat", "/sdcard/sanka-ui.xml").decode("utf-8", "replace")
        nodes = ET.fromstring(xml[xml.index("<?xml"):] if "<?xml" in xml else xml).iter("node")
        return [(n.get("text") or "", n.get("bounds") or "", n.get("class") or "") for n in nodes]

    def texts(self):
        return [t for t, _, _ in self.ui()]

    def tap(self, label):
        for t, b, c in self.ui():
            if t == label and c.endswith("Button"):
                x1, y1, x2, y2 = map(int, re.findall(r"\d+", b))
                self.sh("input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
                time.sleep(1.5)
                return True
        return False

    def card(self, kind, data, answer=None):
        self.sh("run-as", PKG, "rm", "-f", "files/result.json")
        self.put("request.bin", data)
        if answer is not None:
            self.put("answer.json", answer)
        self.put("request.kind", kind.encode())
        self.launch()

    def result(self, name):
        data = self.get("result.json")
        path = os.path.join(self.out, name)
        open(path, "wb").write(data)
        return path

    # -- signer and node --
    def n(self, *args, stdin=None):
        r = subprocess.run(["nbb", "-cp", "src", *args], cwd=EN, input=stdin, capture_output=True, timeout=120)
        lines = r.stdout.decode().strip().splitlines()
        try:
            return json.loads(lines[-1])
        except Exception:
            return {"crash": r.stderr.decode()[-300:]}

    def save(self, name, value):
        path = os.path.join(self.out, name)
        open(path, "wb").write(value if isinstance(value, bytes) else canonical(value))
        return path

    def order(self, nonce):
        return {"kind": "awai.order/1", "work-kind": "compute", "buyer": self.bot, "provider": self.provider,
                "node": self.node_did, "asset": "native/engi/EN", "amount": "1", "value-class": "devnet",
                "model": {"revision": "23749fefcc72300e3a2ad315e1317431b06b590a",
                          "digest": "sha256:9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031"},
                "max-tokens": 64, "expires-at": int(time.time()) + 900, "data-categories": ["prompt"],
                "policy": "sha256:" + "0" * 64, "demand": "owner-internal", "nonce": nonce}

    def receipt(self, order_cid, answer_bytes):
        return {"kind": "awai.work-receipt/1", "work-kind": "compute", "order": order_cid, "provider": self.provider,
                "node": self.node_did, "input": "hmac-sha256:" + "1" * 64, "output": cid(answer_bytes),
                "engine": {"name": "llama.cpp", "version": "9581154a2250cc9e6948e4c2a2fc4b4e19d1a57e",
                           "digest": "sha256:1e8f702fb659aed68757a29678d97897740d9104e137437391f10c8b15d16f61"},
                "model": {"revision": "23749fefcc72300e3a2ad315e1317431b06b590a",
                          "digest": "sha256:9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031"},
                "measured": {"prompt-tokens": 25, "completion-tokens": 12, "started-at": 1794928919, "finished-at": 1794928919},
                "ledger-head": order_cid, "demand": "owner-internal", "nonce": "fixture",
                "signer": self.node_did, "signature": "fixture-not-signed"}

    def go(self):
        a, o = self.a, self.out
        # App and owner key.
        subprocess.run(self.adb + ["install", "-r", a.apk], check=True, capture_output=True)
        self.sh("run-as", PKG, "rm", "-f", "files/request.kind", "files/request.bin", "files/answer.json", "files/result.json")
        self.launch()
        owner = json.loads(self.get("owner.json"))
        self.check("the app makes an owner key in Android Keystore", owner.get("kind") == "awai.sanka.owner-key/1")
        perms = self.sh("dumpsys", "package", PKG).decode()
        self.check("the app has no INTERNET permission", "android.permission.INTERNET" not in perms)

        # Keys, node, funding, signer.
        dids = {}
        for role in ["sponsor", "bot", "provider", "operator", "node"]:
            dids[role] = self.n("host/signer.cljs", "keygen", os.path.join(o, role + ".pem"))["did"]
        self.bot, self.provider, self.node_did = dids["bot"], dids["provider"], dids["node"]
        self.n("host/node.cljs", "init", os.path.join(o, "ledger"), CHAIN, dids["operator"], dids["sponsor"], dids["bot"], dids["provider"])
        self.node_proc = subprocess.Popen(["nbb", "-cp", "src", "host/node.cljs", "serve", os.path.join(o, "ledger"), str(PORT)],
                                          cwd=EN, stdout=open(os.path.join(o, "node.log"), "w"), stderr=subprocess.STDOUT)
        time.sleep(5)
        for i in (1, 2):
            tx = subprocess.run(["nbb", "-cp", "src", "host/signer.cljs", "funding", CHAIN, dids["sponsor"], dids["bot"], f"fund-{i}",
                                 os.urandom(6).hex(), "600000"], cwd=EN, capture_output=True).stdout
            tx = subprocess.run(["nbb", "-cp", "src", "host/signer.cljs", "sign", os.path.join(o, "sponsor.pem")], cwd=EN, input=tx, capture_output=True).stdout
            tx = subprocess.run(["nbb", "-cp", "src", "host/signer.cljs", "sign", os.path.join(o, "bot.pem")], cwd=EN, input=tx, capture_output=True).stdout
            self.n("host/signer.cljs", "submit", "-", NODE, stdin=tx)
        bs = os.path.join(o, "bot-signer")
        self.n("host/signer.cljs", "init", bs, os.path.join(o, "bot.pem"), CHAIN, "1", dids["provider"])
        r = self.n("host/signer.cljs", "enroll", bs, owner["spki"])
        self.check("the signer enrolls the owner's device key", r.get("enrolled") is True, r)

        # Order A: the card, then approval.
        order_a = self.order("v4-a")
        oa, ca = self.save("order-a.json", order_a), cid(canonical(order_a))
        r = self.n("host/signer.cljs", "reserve", bs, NODE, ca, "1")
        self.check("no reservation without the owner's approval", r.get("cause") == ":owner-approval-required", r)
        self.card("order", canonical(order_a))
        shown = self.texts()
        want = [self.provider, "1 native/engi/EN", "devnet — no real value / 実際の価値なし", "prompt", ca, "owner-internal"]
        missing = [w for w in want if w not in shown]
        self.check("the native card shows the order's own fields", not missing, missing)
        self.check("the owner taps Approve on the card", self.tap("承認する · Approve"))
        approval = self.result("approval-a.json")
        r = self.n("host/signer.cljs", "reserve-approved", bs, NODE, oa, approval)
        self.check("the approved order is reserved", r.get("state") == ":reserved", r)

        # Fake dapp key, other order, denial.
        fake = self.fake_statement(json.load(open(approval))["payload"])
        fake["spki"] = owner["spki"]  # claims to be the owner; only the signature can tell
        r = self.n("host/signer.cljs", "reserve-approved", bs, NODE, oa, self.save("approval-fake.json", fake))
        self.check("an approval signed by another key (a fake dapp) is refused", r.get("cause") == ":owner-signature-invalid", r)
        order_x = self.order("v4-x")
        r = self.n("host/signer.cljs", "reserve-approved", bs, NODE, self.save("order-x.json", order_x), approval)
        self.check("an approval for another order is refused", r.get("cause") == ":approval-for-another-order", r)
        order_b = self.order("v4-b")
        self.card("order", canonical(order_b))
        self.tap("拒否する · Deny")
        r = self.n("host/signer.cljs", "reserve-approved", bs, NODE, self.save("order-b.json", order_b), self.result("approval-b.json"))
        self.check("a denied order is not reserved", r.get("cause") == ":owner-denied", r)

        # Acceptance of order A's result.
        answer = canonical({"content": "Tokyo is the capital of Japan.", "role": "assistant"})
        receipt_a = self.receipt(ca, answer)
        ra = self.save("receipt-a.json", receipt_a)
        r = self.n("host/signer.cljs", "propose", bs, ca, "acceptance-label", self.provider, "600000")
        self.check("no settlement without the owner's acceptance", r.get("cause") == ":owner-acceptance-required", r)
        self.card("acceptance", canonical(receipt_a), answer)
        shown = self.texts()
        self.check("the acceptance card shows the answer and the receipt",
                   "Tokyo is the capital of Japan." in shown and cid(canonical(receipt_a)) in shown)
        self.check("the owner taps Accept", self.tap("受け入れる · Accept"))
        acceptance = self.result("acceptance-a.json")
        other = dict(receipt_a, nonce="other")
        r = self.n("host/signer.cljs", "settle-accepted", bs, self.save("receipt-other.json", other), acceptance, "600000")
        self.check("an acceptance for another receipt is refused", r.get("cause") == ":acceptance-for-another-receipt", r)
        tx = self.n("host/signer.cljs", "settle-accepted", bs, ra, acceptance, "600000")
        self.check("the accepted result yields a bot-signed settlement", tx.get("kind") == ":settlement", tx)
        signed = subprocess.run(["nbb", "-cp", "src", "host/signer.cljs", "sign", os.path.join(o, "provider.pem")], cwd=EN,
                                input=canonical(tx), capture_output=True).stdout
        r = self.n("host/signer.cljs", "submit", bs, NODE, stdin=signed)
        self.check("the provider counter-signs and the node finalizes", r.get("finalized") is True, r)

        # Order C: approved, then rejected: no payment.
        order_c = self.order("v4-c")
        self.card("order", canonical(order_c))
        self.tap("承認する · Approve")
        oc, cc = self.save("order-c.json", order_c), cid(canonical(order_c))
        self.n("host/signer.cljs", "reserve-approved", bs, NODE, oc, self.result("approval-c.json"))
        bad_answer = canonical({"content": "Osaka.", "role": "assistant"})
        receipt_c = self.receipt(cc, bad_answer)
        self.card("acceptance", canonical(receipt_c), answer)  # the answer does not match receipt C
        shown = self.texts()
        self.check("an answer that does not match its receipt gets no buttons",
                   "受け入れる · Accept" not in shown and any("一致しません" in t for t in shown))
        self.card("acceptance", canonical(receipt_c), bad_answer)
        self.tap("受け入れない · Reject")
        before = self.balance()
        r = self.n("host/signer.cljs", "settle-accepted", bs, self.save("receipt-c.json", receipt_c), self.result("acceptance-c.json"), "600000")
        self.check("a rejected result releases the reservation and pays nothing",
                   r.get("released") is True and r.get("paid") == 0 and self.balance() == before, r)

        r = self.n("host/signer.cljs", "reconcile", bs, NODE)
        self.check("signer, ledger and journal reconcile", r.get("match") is True, r)
        head = json.loads(subprocess.run(["curl", "-s", NODE + "/v1/head"], capture_output=True).stdout)
        self.node_proc.terminate()
        return {"schema": "awai.sanka.v4-evidence/1", "issue": "AWAI-3123", "serial": a.serial,
                "apk-sha256": hashlib.sha256(open(a.apk, "rb").read()).hexdigest(),
                "owner-spki-sha256": hashlib.sha256(base64.b64decode(owner["spki"])).hexdigest(),
                "chain-id": CHAIN, "value-class": "devnet", "head": head,
                "checks": self.results, "passed": sum(r["passed"] for r in self.results), "total": len(self.results)}

    def balance(self):
        r = json.loads(subprocess.run(["curl", "-s", NODE + "/v1/accounts/" + self.bot], capture_output=True).stdout)
        return r.get("balance")

    def fake_statement(self, payload):
        """The same payload signed by a P-256 key that is not the enrolled owner's."""
        from subprocess import run
        js = ("const c=require('crypto');const k=c.generateKeyPairSync('ec',{namedCurve:'prime256v1'});"
              "const p=process.argv[1];console.log(JSON.stringify({payload:p,"
              "sig:c.sign('sha256',Buffer.from(p),k.privateKey).toString('base64'),"
              "spki:k.publicKey.export({type:'spki',format:'der'}).toString('base64')}))")
        return json.loads(run(["node", "-e", js, payload], capture_output=True).stdout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--serial", required=True)
    ap.add_argument("--apk", required=True)
    ap.add_argument("--out", required=True)
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
