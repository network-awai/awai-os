#!/usr/bin/env python3
"""Measure one GGUF model with the pinned llama-server on a Mac node (AWAI-3391, stage 6 of AWAI-3203).

usage: python3 measure_model.py SERVER MODEL [--ctx 4096] [--port 18797] [--repeats 3] [--tokens 128]

The script starts llama-server under /usr/bin/time -l on 127.0.0.1, waits for /health, sends one
warm-up request and then each fixed prompt REPEATS times. Each request uses temperature 0,
ignore_eos and no prompt cache, so every run decodes exactly TOKENS tokens. It stops the server and
prints one JSON object:

- load_seconds: from process start to the first healthy /health;
- per prompt: the server's own prompt and generation timings (tokens, tokens/s) for every run;
- peak memory from /usr/bin/time -l: the maximum resident set size and the peak memory footprint;
- system memory and swap before and after, and the load average, so a contended run can be seen.

It never sends anything but the fixed prompts, and binds 127.0.0.1 only. Python 3.9 standard library.
"""
import argparse, json, os, re, signal, subprocess, tempfile, threading, time, urllib.request

WORDS = ("A content-addressed store names each block by the hash of its bytes, so two nodes that hold the "
         "same block agree on its name without asking each other. Replication then becomes a question of "
         "which names a node is missing, and a signed head lists the names that make up the current state. ")
PROMPTS = {
    "short": "Explain in two sentences what a Merkle tree is.",
    "medium": "Summarize the following notes for an operator.\n\n" + WORDS * 4,
    "long": "Summarize the following notes for an operator.\n\n" + WORDS * 20,
}


def http(url, body=None, timeout=600):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read() or b"null")


def vm():
    text = subprocess.run(["vm_stat"], capture_output=True, text=True).stdout
    def num(pattern):
        m = re.search(pattern, text)
        if not m:
            raise SystemExit("vm_stat output changed: " + pattern)
        return int(m.group(1))
    page = num(r"page size of (\d+) bytes")
    f = lambda k: num(k + r":\s+(\d+)\.")
    used = page * (max(0, f("Anonymous pages") - f("Pages purgeable")) + f("Pages wired down") + f("Pages occupied by compressor"))
    return {"used_bytes": used, "swapouts": f("Swapouts"), "compressor_pages": f("Pages occupied by compressor")}


def gpu_percent():
    out = subprocess.run(["ioreg", "-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"], capture_output=True, text=True).stdout
    m = re.search(r'"Device Utilization %"=(\d+)', out)
    return int(m.group(1)) if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("server"); ap.add_argument("model")
    ap.add_argument("--ctx", type=int, default=4096); ap.add_argument("--port", type=int, default=18797)
    ap.add_argument("--repeats", type=int, default=3); ap.add_argument("--tokens", type=int, default=128)
    a = ap.parse_args()
    base = f"http://127.0.0.1:{a.port}"
    result = {"model_file": os.path.basename(a.model), "model_bytes": os.path.getsize(a.model), "ctx": a.ctx,
              "tokens": a.tokens, "repeats": a.repeats, "loadavg_before": os.getloadavg(), "vm_before": vm()}
    log = tempfile.NamedTemporaryFile(prefix="measure-", suffix=".log", delete=False)
    t0 = time.monotonic()
    proc = subprocess.Popen(["/usr/bin/time", "-l", a.server, "-m", os.path.abspath(a.model), "--host", "127.0.0.1",
                             "--port", str(a.port), "-c", str(a.ctx), "-ngl", "99", "--no-webui", "-np", "1"],
                            stdout=log, stderr=subprocess.STDOUT)
    try:
        while True:
            if proc.poll() is not None:
                raise SystemExit("server exited before it was healthy")
            try:
                if http(base + "/health", timeout=2)[0] == 200:
                    break
            except Exception:
                pass
            if time.monotonic() - t0 > 600:
                raise SystemExit("server not healthy after 600 s")
            time.sleep(0.25)
        result["load_seconds"] = round(time.monotonic() - t0, 2)
        body = lambda p: {"prompt": p, "n_predict": a.tokens, "temperature": 0, "seed": 1, "ignore_eos": True, "cache_prompt": False}
        http(base + "/completion", body(PROMPTS["short"]))  # warm-up, not counted
        runs = {}
        # This engine build logs no Metal or offload lines, so GPU use is sampled from IOAccelerator during the runs.
        samples, done = [], threading.Event()
        def sample():
            while not done.is_set():
                samples.append(gpu_percent()); done.wait(0.5)
        sampler = threading.Thread(target=sample, daemon=True); sampler.start()
        for name, prompt in PROMPTS.items():
            runs[name] = []
            for _ in range(a.repeats):
                _, r = http(base + "/completion", body(prompt))
                t = r["timings"]
                runs[name].append({"prompt_n": t["prompt_n"], "prompt_per_second": round(t["prompt_per_second"], 2),
                                   "predicted_n": t["predicted_n"], "predicted_per_second": round(t["predicted_per_second"], 2)})
        done.set(); sampler.join()
        known = [x for x in samples if x is not None]
        result["gpu_percent_samples"] = len(known)
        result["gpu_percent_max"] = max(known) if known else None
        result["gpu_percent_median"] = sorted(known)[len(known) // 2] if known else None
        result["runs"] = runs
        result["vm_during"] = vm()
    finally:
        proc.send_signal(signal.SIGINT)
        try:
            proc.wait(timeout=60)
        except subprocess.TimeoutExpired:
            proc.kill(); proc.wait()
    text = open(log.name, errors="replace").read()
    rss = re.search(r"(\d+)\s+maximum resident set size", text)
    peak = re.search(r"(\d+)\s+peak memory footprint", text)
    result["max_rss_bytes"] = int(rss.group(1)) if rss else None
    result["peak_footprint_bytes"] = int(peak.group(1)) if peak else None
    result["vm_after"] = vm()
    result["engine_log"] = [l.strip() for l in text.splitlines() if "load_model" in l or "error" in l.lower()][:20]
    os.unlink(log.name)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
