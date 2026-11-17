#!/usr/bin/env python3
"""ADR 0027 V2 (AWAI-3103): a real order against the provider desk on another Mac.

The provider operator has already started, on the provider host, a loopback-only llama-server and
`provider/desk.cljs serve` (see provider/README.md). This harness plays the buyer from another host:

  * registers each order through the operator's own command over SSH (registration has no HTTP route),
  * calls the desk through an SSH tunnel, so nothing listens on the provider's network interfaces,
  * checks every receipt with tools/verify_receipt.lpy, which shares no code with the desk,
  * then tries to break it: no key, an unknown key, a used key, another order's key, an order for
    another model, node or provider, a live or expired order, a second order on a used key, and a
    changed output, request, key or signature at the verifier.

It writes evidence JSON with hashes only, never the prompt, the output or a key. Exit 0 only when
every check passes. Usage:

  python3 test/live_v2.py --host benjamin --remote-sanka DIR --remote-root DIR --port 18788 \
      --provider DID --node DID --model-revision REV --model-sha256 HEX --out FILE
"""
import argparse, hashlib, json, os, secrets, socket, subprocess, sys, tempfile, time, urllib.error, urllib.request

PROMPT = "Answer in one short sentence: what is the capital of Japan?"
BUYER = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH"


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha(data):
    return hashlib.sha256(data).hexdigest()


class Run:
    def __init__(self, args):
        self.args = args
        self.results = []
        self.tmp = tempfile.mkdtemp(prefix="sanka-v2-")
        self.serial = 0

    def check(self, name, passed, detail=None):
        self.results.append({"check": name, "passed": bool(passed), "detail": detail})
        print(("PASS " if passed else "FAIL ") + name + (f"  {detail}" if detail else ""), flush=True)

    # -- provider operator command over SSH --

    def operator(self, *argv, stdin=None):
        remote = " ".join(["cd", self.args.remote_sanka, "&&", "export PATH=/opt/homebrew/bin:$PATH", "&&",
                           "nbb", "-cp", "src", "provider/desk.cljs"] + [f"'{a}'" for a in argv])
        out = subprocess.run(["ssh", "-o", "BatchMode=yes", self.args.host, remote], input=stdin,
                             capture_output=True, timeout=120)
        return json.loads(out.stdout.decode("utf-8").strip().splitlines()[-1])

    # -- buyer --

    def order(self, **changes):
        self.serial += 1
        order = {
            "kind": "awai.order/1", "work-kind": "compute", "buyer": BUYER, "provider": self.args.provider,
            "node": self.args.node, "asset": "native/engi/EN", "amount": "1", "value-class": "devnet",
            "model": {"revision": self.args.model_revision, "digest": "sha256:" + self.args.model_sha256},
            "max-tokens": 64, "expires-at": int(time.time()) + 900, "data-categories": ["prompt"],
            "policy": "sha256:" + "0" * 64, "demand": "owner-internal",
            "nonce": f"live-v2-{self.serial}-{secrets.token_hex(4)}",
        }
        order.update(changes)
        return order

    def register(self, order, key):
        return self.operator("register", self.args.remote_root, "-", sha(key.encode("utf-8")),
                             stdin=canonical(order))

    def call(self, method, path, key=None, body=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.args.local_port}{path}", data=body, method=method)
        if key:
            req.add_header("Authorization", "Bearer " + key)
        if body is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=600) as res:
                return res.status, dict(res.headers), res.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()

    def chat(self, key, prompt=PROMPT):
        body = json.dumps({"messages": [{"role": "user", "content": prompt + " /no_think"}],
                           "temperature": 0, "seed": 7}).encode("utf-8")
        return body, self.call("POST", "/v1/chat/completions", key, body)

    def save(self, name, data):
        path = os.path.join(self.tmp, name)
        with open(path, "wb") as f:
            f.write(data if isinstance(data, bytes) else canonical(data))
        return path

    def verify(self, order, receipt, request, response, key):
        files = [self.save("order.json", order), self.save("receipt.json", receipt), self.save("request.bin", request),
                 self.save("response.json", response), self.save("key.txt", key.encode("utf-8"))]
        out = subprocess.run([self.args.basilisp, "run", "tools/verify_receipt.lpy", *files],
                             env={**os.environ, "PYTHONPATH": "src", "PYTHONDONTWRITEBYTECODE": "1"},
                             capture_output=True, timeout=300)
        try:
            verdict = json.loads(out.stdout.decode("utf-8").strip().splitlines()[-1])
        except Exception:
            verdict = {"ok": False, "errors": ["verifier-crashed"], "stderr": out.stderr.decode()[-400:]}
        return out.returncode, verdict

    def code(self, response):
        try:
            return json.loads(response[2])["error"]["code"]
        except Exception:
            return None

    def go(self):
        a = self.args
        # 1. The real order.
        key = secrets.token_urlsafe(32)
        order = self.order()
        reg = self.register(order, key)
        cid = reg.get("order")
        self.check("the operator registers the order on the provider host", bool(cid), reg)
        self.check("the order CID is the CID of the buyer's canonical order",
                   cid is not None and cid == self.cid_of(canonical(order)))
        started = time.time()
        request, res = self.chat(key)
        elapsed = time.time() - started
        self.check("the desk serves the order through the tunnel", res[0] == 200, res[0])
        reply = json.loads(res[2]) if res[0] == 200 else {}
        text = (((reply.get("choices") or [{}])[0].get("message") or {}).get("content") or "")
        self.check("the answer is a real model answer naming Tokyo", "tokyo" in text.lower())
        status, _, rbody = self.call("GET", f"/v1/orders/{cid}/receipt", key)
        receipt = json.loads(rbody) if status == 200 else {}
        self.check("the receipt reads back with the order's key", status == 200, status)
        self.check("the X-Awai-Receipt header names the stored receipt",
                   res[1].get("X-Awai-Receipt") == self.cid_of(canonical(receipt)))
        rc, verdict = self.verify(order, receipt, request, reply, key)
        self.check("the independent verifier accepts the receipt", rc == 0 and verdict.get("ok"), verdict)
        self.check("the receipt holds no prompt, output or key",
                   PROMPT not in json.dumps(receipt) and text not in json.dumps(receipt) and key not in json.dumps(receipt))
        measured = receipt.get("measured", {})

        # 2. Gateway refusals.
        self.check("a used key is refused, not run again", self.code(self.chat(key)[1]) == "order_used")
        self.check("a request without a key opens nothing", self.call("POST", "/v1/chat/completions", None, request)[0] == 401)
        self.check("an unknown key opens nothing", self.code(self.chat(secrets.token_urlsafe(32))[1]) == "order_key")
        self.check("an order's key opens no other route", self.code(self.call("GET", "/props", key)) == "not_found")
        other_key = secrets.token_urlsafe(32)
        other = self.order()
        other_cid = self.register(other, other_key).get("order")
        self.check("another order's key cannot read this receipt",
                   self.code(self.call("GET", f"/v1/orders/{cid}/receipt", other_key)) == "not_found")
        self.check("a second order cannot reuse a registered key",
                   self.register(self.order(), other_key).get("error", {}).get("code") == "order_key_used")
        self.check("the same order cannot register twice",
                   self.register(other, secrets.token_urlsafe(32)).get("error", {}).get("code") == "order_exists")
        bad = {
            "another model": (self.order(model={"revision": a.model_revision, "digest": "sha256:" + "1" * 64}), "order_model"),
            "another node": (self.order(node=BUYER.replace("H", "J")), "order_node"),
            "another provider": (self.order(provider=BUYER.replace("H", "K")), "order_provider"),
            "a live order": (self.order(**{"value-class": "live"}), "order_invalid"),
            "an expired order": (self.order(**{"expires-at": int(time.time()) - 1}), "order_expired"),
            "the node as payee": (self.order(provider=a.node), "order_invalid"),
        }
        for name, (o, want) in bad.items():
            got = self.register(o, secrets.token_urlsafe(32)).get("error", {}).get("code")
            self.check(f"the desk refuses {name}", got == want, got)
        self.check("an unspent order still serves after the refusals", self.chat(other_key)[1][0] == 200)

        # 3. Verifier refusals on the real receipt.
        changed_reply = json.loads(json.dumps(reply))
        changed_reply["choices"][0]["message"]["content"] = text + " (changed)"
        forged = dict(receipt, signature=receipt.get("signature", "")[:-4] + "AAAA")
        cases = {
            "a changed output": (order, receipt, request, changed_reply, key, "verify/output"),
            "another request": (order, receipt, request + b" ", reply, key, "verify/input"),
            "the wrong key": (order, receipt, request, reply, secrets.token_urlsafe(32), "verify/input"),
            "a forged signature": (order, forged, request, reply, key, "verify/signature"),
            "another order": (other, receipt, request, reply, key, "receipt/other-order"),
        }
        for name, (o, r, q, s, k, want) in cases.items():
            rc, v = self.verify(o, r, q, s, k)
            self.check(f"the verifier refuses {name}", rc != 0 and want in v.get("errors", []), v.get("errors"))

        # 4. What the provider kept.
        stored = self.operator("receipt", a.remote_root, cid)
        self.check("the stored receipt equals the one served", stored == receipt)

        return {
            "schema": "awai.sanka.v2-evidence/1", "issue": "AWAI-3103", "host": a.host,
            "provider": a.provider, "node": a.node, "order": cid, "receipt": self.cid_of(canonical(receipt)),
            "engine": receipt.get("engine"), "model": receipt.get("model"), "demand": order["demand"],
            "value-class": order["value-class"], "measured": measured,
            "wall-seconds-through-tunnel": round(elapsed, 3),
            "answer-sha256": sha(text.encode("utf-8")), "answer-chars": len(text),
            "checks": self.results,
            "passed": sum(r["passed"] for r in self.results), "total": len(self.results),
        }

    @staticmethod
    def cid_of(data):
        import base64
        raw = bytes([0x01, 0xa9, 0x02, 0x12, 0x20]) + hashlib.sha256(data).digest()
        return "b" + base64.b32encode(raw).decode("ascii").lower().rstrip("=")


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def main():
    ap = argparse.ArgumentParser()
    for name in ["host", "remote-sanka", "remote-root", "provider", "node", "model-revision", "model-sha256", "out"]:
        ap.add_argument("--" + name, required=True)
    ap.add_argument("--port", type=int, default=18788)
    ap.add_argument("--basilisp", default="basilisp")
    args = ap.parse_args()
    args.local_port = free_port()
    tunnel = subprocess.Popen(["ssh", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-N",
                               "-L", f"127.0.0.1:{args.local_port}:127.0.0.1:{args.port}", args.host])
    try:
        for _ in range(40):
            try:
                socket.create_connection(("127.0.0.1", args.local_port), timeout=1).close(); break
            except OSError:
                time.sleep(0.5)
        evidence = Run(args).go()
    finally:
        tunnel.terminate()
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(evidence, f, indent=2, ensure_ascii=False); f.write("\n")
    print(f"{evidence['passed']} of {evidence['total']} checks")
    sys.exit(0 if evidence["passed"] == evidence["total"] else 1)


if __name__ == "__main__":
    main()
