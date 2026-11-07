#!/usr/bin/env python3
"""Runs one real order through llama.cpp and the Hy gateway, then tries to break it (ADR 0027 V1).

It starts real processes on this machine, and writes the measured results to --evidence. The order
has no value and moves nothing. Only a run inside nixos/tests/sanka-v1.nix counts for the VM gate.

usage: python3 test/live_v1.py --gateway DIR --python PY --basilisp BIN --llama-server BIN
         --model GGUF --revision REV --model-sha256 HEX --source URL --environment TEXT
         --work DIR --evidence FILE
"""
import argparse
import copy
import hashlib
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

PROVIDER = "did:key:z6MkLiveV1ProviderOperatorIsNotTheNodeKey"
BUYER = "did:key:z6MkLiveV1BuyerBot"
PROMPT = "Once upon a time there was a little fox who"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def key_hash(key):
    return hashlib.sha256(key.encode()).hexdigest()


class Client:
    """Talks to the gateway. It ignores any proxy, and it returns refusals rather than raising."""

    def __init__(self, base):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def raw(self, method, path, data=None, key=None):
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if key:
            req.add_header("Authorization", "Bearer " + key)
        try:
            with self.opener.open(req, timeout=300) as res:
                return res.status, dict(res.headers), res.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()

    def call(self, method, path, body=None, key=None):
        data = None if body is None else json.dumps(body).encode()
        status, headers, raw = self.raw(method, path, data, key)
        return status, headers, json.loads(raw) if raw else None


def wait_until(check, what, seconds=60):
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            if check():
                return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.2)
    raise SystemExit(f"timed out waiting for {what}")


class Live:
    def __init__(self, args):
        self.args = args
        self.work = os.path.abspath(args.work)
        self.state = os.path.join(self.work, "state")
        self.api_key = secrets.token_hex(24)
        self.processes = []
        self.results = []
        self.serial = 0
        self.gateway_process = None
        self.client = None
        self.node = None
        self.logs = []

    def spawn(self, name, command, cwd=None, env=None):
        log = open(os.path.join(self.work, name + ".log"), "wb")
        self.logs.append(log)
        process = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
        self.processes.append(process)
        return process

    def start_engine(self):
        port = free_port()
        self.engine_url = f"http://127.0.0.1:{port}"
        self.spawn("llama-server", [self.args.llama_server, "--model", self.args.model,
                                    "--host", "127.0.0.1", "--port", str(port),
                                    "--ctx-size", "256", "--parallel", "1", "--no-webui"])
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        def ready():
            with opener.open(self.engine_url + "/health", timeout=2) as res:
                return res.status == 200

        wait_until(ready, "llama-server", 120)

    def start_gateway(self, model_file):
        port = free_port()
        env = {**os.environ, "HERMES_HOME": os.path.join(self.work, "home"),
               "KOTOBA_STATE_ROOT": self.state, "API_SERVER_KEY": self.api_key,
               "KOTOBA_GOSSIP_SECONDS": "3600"}
        self.gateway_process = self.spawn(
            f"gateway-{len(self.processes)}",
            [self.args.python, "kotoba_gateway_main.py", "--backend", "echo",
             "--host", "127.0.0.1", "--port", str(port),
             "--order-provider", PROVIDER, "--order-upstream", self.engine_url,
             "--order-engine-file", self.engine_binary, "--order-engine-version", self.engine_version,
             "--order-model-file", model_file, "--order-model-revision", self.args.revision],
            cwd=self.args.gateway, env=env)
        self.client = Client(f"http://127.0.0.1:{port}")

        def ready():
            return self.client.call("GET", "/health")[0] == 200

        wait_until(ready, "the gateway")
        self.node = self.client.call("GET", "/health")[2]["node"]

    def stop_gateway(self):
        self.gateway_process.terminate()
        self.gateway_process.wait(timeout=30)

    def order(self, **changes):
        self.serial += 1
        order = {
            "kind": "awai.order/1", "work-kind": "compute", "buyer": BUYER, "provider": PROVIDER,
            "node": self.node, "asset": "native/engi/EN", "amount": "1", "value-class": "devnet",
            "model": {"revision": self.args.revision, "digest": "sha256:" + self.args.model_sha256},
            "max-tokens": 24, "expires-at": int(time.time()) + 900, "data-categories": ["prompt"],
            "policy": "sha256:" + "0" * 64, "demand": "replay", "nonce": f"live-v1-{self.serial}-{secrets.token_hex(4)}",
        }
        order.update(changes)
        return order

    def register(self, order, key):
        return self.client.call("POST", "/v1/orders", {"order": order, "key_sha256": key_hash(key)},
                                key=self.api_key)

    def check(self, name, passed, detail=None):
        self.results.append({"check": name, "passed": bool(passed), "detail": detail})
        print(("PASS " if passed else "FAIL ") + name + (f"  {detail}" if detail else ""))

    def verifier(self, order_file, receipt_file, request_file, response_file, key_file):
        result = subprocess.run(
            [self.args.basilisp, "run", "tools/verify_receipt.lpy", order_file, receipt_file,
             request_file, response_file, key_file],
            # Basilisp would otherwise write bytecode beside its sources, which Nix keeps read-only.
            cwd=self.args.dapp, env={**os.environ, "PYTHONPATH": "src", "PYTHONDONTWRITEBYTECODE": "1"},
            capture_output=True, text=True, timeout=120)
        last = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else "{}"
        try:
            return result.returncode, json.loads(last)
        except json.JSONDecodeError:
            return result.returncode, {"errors": ["verifier/crashed"], "stderr": result.stderr[-400:]}

    def save(self, name, data):
        path = os.path.join(self.work, name)
        with open(path, "wb") as f:
            f.write(data if isinstance(data, bytes) else json.dumps(data).encode())
        return path

    def run(self):
        args = self.args
        os.makedirs(self.state, exist_ok=True)
        os.makedirs(os.path.join(self.work, "home"), exist_ok=True)
        self.check("the model file has the pinned digest", sha256_file(args.model) == args.model_sha256)
        self.engine_binary = os.path.realpath(args.llama_server)
        version = subprocess.run([args.llama_server, "--version"], capture_output=True, text=True)
        self.engine_version = (version.stdout + version.stderr).splitlines()[0]
        self.start_engine()
        self.start_gateway(args.model)

        # A real order.
        key = secrets.token_hex(24)
        order = self.order()
        status, _, body = self.register(order, key)
        self.check("an order registers", status == 201, status)
        cid = body["order"]
        request = json.dumps({"model": "m", "messages": [{"role": "user", "content": PROMPT}],
                              "temperature": 0}).encode()
        status, headers, raw = self.client.raw("POST", "/v1/chat/completions", request, key)
        self.check("real inference answers", status == 200, status)
        response = json.loads(raw)
        content = response["choices"][0]["message"].get("content") or ""
        self.check("the model produced text", len(content) > 0, f"{len(content)} characters")
        status, _, receipt = self.client.call("GET", f"/v1/orders/{cid}/receipt", key=key)
        self.check("the receipt reads back", status == 200, status)
        measured = receipt["measured"]
        self.check("the engine's own measurement is in the receipt",
                   measured["prompt-tokens"] > 0 and measured["completion-tokens"] > 0, measured)

        files = {
            "order": self.save("order.json", order),
            "receipt": self.save("receipt.json", receipt),
            "request": self.save("request.bin", request),
            "response": self.save("response.json", response),
            "key": self.save("key.txt", key.encode()),
        }
        code, verdict = self.verifier(files["order"], files["receipt"], files["request"],
                                      files["response"], files["key"])
        self.check("the independent verifier accepts it", code == 0 and verdict.get("ok") is True, verdict)
        self.check("the verifier and the gateway agree on the order CID", verdict.get("order") == cid)
        self.check("the verifier and the gateway agree on the receipt CID",
                   verdict.get("receipt") == headers.get("X-Awai-Receipt"))

        # The verifier has to refuse altered evidence.
        def refused(name, want, **paths):
            use = {**files, **paths}
            code, verdict = self.verifier(use["order"], use["receipt"], use["request"],
                                          use["response"], use["key"])
            self.check(name, code == 1 and want in verdict.get("errors", []), verdict.get("errors"))

        altered = copy.deepcopy(response)
        altered["choices"][0]["message"]["content"] = content + " and more"
        refused("a changed output is refused", "verify/output",
                response=self.save("altered-response.json", altered))
        padded = copy.deepcopy(receipt)
        padded["measured"]["completion-tokens"] += 1000
        refused("a padded measurement is refused", "verify/signature",
                receipt=self.save("altered-receipt.json", padded))
        forged = copy.deepcopy(receipt)
        forged["signature"] = "A" * len(forged["signature"])
        refused("a forged signature is refused", "verify/signature",
                receipt=self.save("forged-receipt.json", forged))
        refused("a different request is refused", "verify/input",
                request=self.save("other-request.bin", request + b" "))
        refused("the wrong key is refused", "verify/input",
                key=self.save("other-key.txt", b"not-the-key"))
        other_model = copy.deepcopy(order)
        other_model["model"]["digest"] = "sha256:" + "f" * 64
        refused("a receipt for another order is refused", "receipt/other-order",
                order=self.save("other-order.json", other_model))
        carrying = copy.deepcopy(receipt)
        carrying["prompt"] = PROMPT
        refused("a receipt carrying the prompt is refused", "receipt/unknown-field",
                receipt=self.save("carrying-receipt.json", carrying))

        # The gateway has to refuse these before any work happens.
        status, _, body = self.client.call("POST", "/v1/chat/completions",
                                           {"messages": [{"role": "user", "content": PROMPT}]}, key=key)
        self.check("a used key is refused", status == 409 and body["error"]["code"] == "order_used", status)
        status, _, _ = self.client.call("POST", "/v1/chat/completions",
                                        {"messages": [{"role": "user", "content": PROMPT}]}, key="no-such-key")
        self.check("an unknown key is refused", status == 401, status)
        status, _, body = self.register(self.order(model={"revision": args.revision,
                                                          "digest": "sha256:" + "f" * 64}),
                                        secrets.token_hex(24))
        self.check("an order for another model is refused", status == 400 and body["error"]["code"] == "order_model", status)
        status, _, body = self.register(self.order(**{"value-class": "live"}), secrets.token_hex(24))
        self.check("a live order is refused", status == 400 and body["error"]["code"] == "order_live", status)
        status, _, body = self.register(self.order(node="did:key:zAnotherNode"), secrets.token_hex(24))
        self.check("an order for another node is refused", status == 400 and body["error"]["code"] == "order_node", status)

        # A client that only streams reads the same kind of result.
        stream_key = secrets.token_hex(24)
        status, _, body = self.register(self.order(), stream_key)
        stream_cid = body["order"]
        status, headers, raw = self.client.raw(
            "POST", "/v1/chat/completions",
            json.dumps({"stream": True, "messages": [{"role": "user", "content": PROMPT}]}).encode(), stream_key)
        self.check("a streaming call works", status == 200 and b"[DONE]" in raw, status)
        status, _, _ = self.client.call("GET", f"/v1/orders/{stream_cid}/receipt", key=stream_key)
        self.check("a streaming call has a receipt", status == 200, status)

        # Nothing readable stays behind.
        leaks = []
        needles = [PROMPT.encode(), content.encode(), key.encode()]
        for folder, _, names in os.walk(self.state):
            for name in names:
                with open(os.path.join(folder, name), "rb") as f:
                    data = f.read()
                if any(needle in data for needle in needles):
                    leaks.append(os.path.relpath(os.path.join(folder, name), self.state))
        self.check("the provider kept no prompt, output or key", not leaks, leaks or None)

        # A restart keeps the receipt and the spent key.
        self.stop_gateway()
        self.start_gateway(args.model)
        status, _, again = self.client.call("GET", f"/v1/orders/{cid}/receipt", key=key)
        self.check("the receipt survives a restart", status == 200 and again == receipt, status)
        status, _, body = self.client.call("POST", "/v1/chat/completions",
                                           {"messages": [{"role": "user", "content": PROMPT}]}, key=key)
        self.check("the key stays spent after a restart", status == 409, status)
        status, _, head = self.client.call("GET", f"/v1/sessions/order-{cid}/head", key=self.api_key)
        self.check("the ledger head matches the receipt", status == 200 and head["cid"] == receipt["ledger-head"], status)
        status, _, block = self.client.call("GET", f"/v1/blocks/{receipt['ledger-head']}", key=self.api_key)
        self.check("the ledger block has only hashes",
                   status == 200 and block.get("output") == receipt["output"]
                   and block.get("input") == receipt["input"] and PROMPT not in json.dumps(block), status)

        # A gateway declaring a model the engine is not serving refuses to spend the order.
        self.stop_gateway()
        other_file = os.path.join(self.work, "other-model.gguf")
        shutil.copyfile(args.model, other_file)
        self.start_gateway(other_file)
        mismatch_key = secrets.token_hex(24)
        status, _, body = self.register(self.order(), mismatch_key)
        status, _, body = self.client.call("POST", "/v1/chat/completions",
                                           {"messages": [{"role": "user", "content": PROMPT}]}, key=mismatch_key)
        self.check("an engine serving another file is refused",
                   status == 502 and body["error"]["code"] == "upstream_model_mismatch", status)
        os.remove(other_file)

        failed = [row["check"] for row in self.results if not row["passed"]]
        evidence = {
            "schema": "awai.sanka-live-v1/1",
            "environment": args.environment,
            "date": time.strftime("%Y-%m-%d"),
            "value": "none: nothing moved, and the demand class is replay",
            "engine": {"binary-sha256": sha256_file(self.engine_binary), "version": self.engine_version},
            "model": {"source": args.source, "revision": args.revision, "sha256": args.model_sha256,
                      "bytes": os.path.getsize(args.model)},
            "order-cid": cid,
            "measured": measured,
            "receipt": receipt,
            "checks": self.results,
            "failed": failed,
        }
        os.makedirs(os.path.dirname(os.path.abspath(args.evidence)), exist_ok=True)
        with open(args.evidence, "w", encoding="utf-8") as f:
            json.dump(evidence, f, indent=1, ensure_ascii=False)
            f.write("\n")
        print(f"{len(self.results) - len(failed)} of {len(self.results)} checks passed")
        return 0 if not failed else 1

    def close(self):
        for process in self.processes:
            if process.poll() is None:
                process.terminate()
        for process in self.processes:
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
        for log in self.logs:
            log.close()


def main():
    parser = argparse.ArgumentParser()
    for name in ["gateway", "python", "basilisp", "llama-server", "model", "revision", "model-sha256",
                 "work", "evidence", "source", "environment"]:
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    args.dapp = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    args.basilisp = os.path.abspath(args.basilisp)
    args.python = os.path.abspath(args.python)
    args.model = os.path.abspath(args.model)
    args.evidence = os.path.abspath(args.evidence)
    os.makedirs(args.work, exist_ok=True)
    live = Live(args)
    try:
        return live.run()
    finally:
        live.close()


if __name__ == "__main__":
    sys.exit(main())
