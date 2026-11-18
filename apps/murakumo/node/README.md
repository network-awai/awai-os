# Murakumo node usage reporter (AWAI-3377)

`usage-reporter.cljs` runs on a Mac node with nbb (ADR 0026 D3, as the Sanka desk does). It produces an
`awai.murakumo.device-usage.v1` snapshot and signs it with a usage-report Ed25519 key of its own. Murakumo's
All devices list reads it from a phone. The reporter is read only: it never loads a model, starts
inference or accepts a request body.

## What it reports

| Field | Source | Unknown when |
| --- | --- | --- |
| RAM total / used | `sysctl hw.memsize`; `vm_stat` (anonymous − purgeable + wired + compressed, as Activity Monitor counts it) | a field is missing |
| CPU % | user + sys of the last `top -l 2` sample (all cores) | `top` gives no sample |
| GPU % | `ioreg` IOAccelerator "Device Utilization %", readable without root | the key is absent |
| Disk free / total | `df -k` of the reporter's root | `df` fails |
| Loaded model | the loopback llama-server: `/health`, `/props` (path, `n_ctx`), `/slots` (busy) | see `engine` |
| `engine` | `serving`, `loading`, `none`, `not-configured` or `unknown` | — |

The loaded model is named only when the served path and its file stamp equal a catalog file. `init`
admits that file by size and SHA-256. Any other model is `unrecognized`. `since-ms` is when this
reporter first saw the model served, not when the engine loaded it. While a model loads, llama-server
names neither the model nor its context, so `loaded` stays null and `engine` is `loading`.

## Report format

```json
{"schema":"awai.murakumo.device-usage-report.v1","payload":"<usage JSON>","key":"<raw Ed25519 public key, base64url>","signature":"<base64url>"}
```

The signature covers the UTF-8 bytes `awai.murakumo.device-usage-report.v1` + `\n` + `payload`, exactly as
sent. The phone verifies them against the key pinned in `../devices.json` before parsing the payload,
then checks that the payload names the pinned device id and kind. A report whose `key` differs from the
pin is refused even when its signature is valid for that key.

## Operator steps (Mac node)

```bash
W=~/github/workspaces/claude/awai-3377            # task folder; holds murakumo/node, murakumo/catalog.json, root/
nbb murakumo/node/usage-reporter.cljs init root benjamin --upstream http://127.0.0.1:18787 \
    --model qwen3-0.6b-q8_0=/abs/path/Qwen3-0.6B-Q8_0.gguf      # prints the public key to pin
nohup nbb murakumo/node/usage-reporter.cljs serve root 18790 > reporter.log 2>&1 & echo $! > reporter.pid
tailscale serve --bg --https=8443 http://127.0.0.1:18790          # tailnet only (not Funnel)
```

- `init` keeps an existing key. It refuses an upstream that is not `http://127.0.0.1:PORT`, and a model
  file whose size or SHA-256 differs from the catalog.
- `serve` binds `127.0.0.1` and answers only `GET /v1/murakumo/usage`, plus its CORS preflight.
  - Only the configured origins get CORS headers; the default is `https://tauri.localhost`.
  - Requests are throttled: one measurement per 2 s.
  - Each request writes one log line: time, method, path and status.
- Undo: `tailscale serve --https=8443 off`, then `kill $(cat reporter.pid)`.

Tailscale Serve issues a certificate for `<node>.<tailnet>.ts.net`, so that name appears in public
Certificate Transparency logs (owner decision 2026-11-18, AWAI-3377).
