#!/usr/bin/env python3
"""Run node/measure_model.py for each model on each Mac node over SSH (AWAI-3391).

usage: python3 test/measure_nodes.py --out DIR --remote REMOTE_DIR HOST:MODEL_FILE[,MODEL_FILE...] ...

REMOTE_DIR on each host holds bin/llama-server, models/ and fetch.log (from the pinned fetch script).
The nodes run in parallel and each node's models run one after another, so two models never share a
node. A node waits until fetch.log says DONE. Each result is written raw to DIR/<host>/<model>.json,
and DIR/summary.json gets medians per prompt.
"""
import argparse, json, os, statistics, subprocess, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "node", "measure_model.py")
SSH = ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes"]


def ssh(host, cmd, timeout=None):
    return subprocess.run(SSH + [host, cmd], capture_output=True, text=True, timeout=timeout)


def node(host, models, remote, out, results):
    subprocess.run(["scp", "-q", SCRIPT, f"{host}:{remote.replace('~/', '')}/measure_model.py"], check=True)
    while "DONE" not in ssh(host, f"cat {remote}/fetch.log 2>/dev/null").stdout:
        time.sleep(20)
    fetch = ssh(host, f"cat {remote}/fetch.log").stdout
    os.makedirs(os.path.join(out, host), exist_ok=True)
    for model in models:
        r = ssh(host, f"cd {remote} && /usr/bin/python3 measure_model.py bin/llama-server models/{model}", timeout=3600)
        path = os.path.join(out, host, model + ".json")
        if r.returncode != 0:
            results[(host, model)] = {"error": r.stderr.strip()[-500:]}
        else:
            results[(host, model)] = json.loads(r.stdout)
        with open(path, "w") as f:
            json.dump(results[(host, model)], f, indent=2)
        print(host, model, "ok" if r.returncode == 0 else "FAILED", flush=True)
    results[(host, "_fetch")] = fetch.strip().splitlines()


def median(runs, key):
    return round(statistics.median(r[key] for r in runs), 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True); ap.add_argument("--remote", required=True)
    ap.add_argument("plan", nargs="+")
    a = ap.parse_args()
    plan = {p.split(":", 1)[0]: p.split(":", 1)[1].split(",") for p in a.plan}
    results = {}
    threads = [threading.Thread(target=node, args=(h, ms, a.remote, a.out, results)) for h, ms in plan.items()]
    for t in threads: t.start()
    for t in threads: t.join()
    summary = {"schema": "awai.murakumo.measure-6-summary/1", "issue": "AWAI-3391", "rows": [], "fetch": {}}
    for (host, model), r in sorted(results.items()):
        if model == "_fetch":
            summary["fetch"][host] = r; continue
        row = {"host": host, "model_file": model}
        if "error" in r:
            row["error"] = r["error"]
        else:
            row.update({"load_seconds": r["load_seconds"], "max_rss_bytes": r["max_rss_bytes"],
                        "peak_footprint_bytes": r["peak_footprint_bytes"],
                        "system_used_delta_bytes": r["vm_during"]["used_bytes"] - r["vm_before"]["used_bytes"],
                        "swapouts_delta": r["vm_after"]["swapouts"] - r["vm_before"]["swapouts"],
                        "gpu_percent_median": r["gpu_percent_median"], "loadavg_before": r["loadavg_before"],
                        "prompts": {k: {"prompt_n": v[0]["prompt_n"], "prompt_tps_median": median(v, "prompt_per_second"),
                                        "gen_tps_median": median(v, "predicted_per_second"),
                                        "gen_tps_range": [min(x["predicted_per_second"] for x in v), max(x["predicted_per_second"] for x in v)]}
                                    for k, v in r["runs"].items()}})
        summary["rows"].append(row)
    with open(os.path.join(a.out, "summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    print(json.dumps(summary["rows"], indent=1))
    sys.exit(1 if any("error" in r for r in summary["rows"]) else 0)


if __name__ == "__main__":
    main()
