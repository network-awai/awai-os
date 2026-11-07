# Awai Otehon Hermes 0.1.0

The OS agent (ADR 0026 D14, AWAI-167): the chat in the shell talks to Hermes Agent on this machine,
and Hermes answers from a small local model. **Status: partial. No image has booted with this yet.**
The VM check below is written and has never run: the image does not fit its 16 GB root, and the
build machine does not have the disk for a bigger one. See
"Evidence" for what was seen.

| Part | What it is |
| --- | --- |
| Module | `nixos/otehon/hermes.nix`. The profile `desktop-agent` adds it to the desktop. `desktop.nix` does not include it |
| Hermes | Upstream commit `4d04303818b61bf3aa09278af48356315515965b`, through its own `flake.lock`, with no optional dependency groups. API server on `127.0.0.1:8642` |
| Model | `qwen2.5-1.5b-instruct-q4_k_m.gguf`, in the image, through llama.cpp on `127.0.0.1:8771` with a 64000 token window |
| Tools | `platform_toolsets.api_server = [saifu]`, so no terminal or file tools. The `tool_search` bridge is off |
| Saifu | `dapps/saifu/mcp/server.lpy` on Basilisp, as an `mcp_servers` entry |
| Shell | `shell/src/agent.js` sends chat with the app as a system message, streams the answer and shows errors. The "no agent" notice goes away only while Hermes accepts the key and the model answers `/health` |
| Key | Made at each boot by `otehon-agent-key`. `/run/otehon-agent/key.js` is readable by the shell's user and root, and the page loads it as a script |

The model comes from `Qwen/Qwen2.5-1.5B-Instruct-GGUF`, revision
`91cad51170dc346986eccefdc2dd33a9da36ead9`, 1117320736 bytes, sha256
`6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e`, license Apache-2.0. These values
come from the Hugging Face API, and `fetchurl` enforces the digest when the image is built. Nothing
downloads at run time.

Hermes allows the origin `null`, which is what a `file://` page sends, and no other browser origin.
Both services have `IPAddressDeny=any` with localhost allowed, and Hermes has no fallback provider,
so an answer comes from this machine or there is an error.

## Build

The Hermes package uses `builtins.getFlake`, so these profiles need flakes on top of the build in
[vm-0.1.0.md](vm-0.1.0.md):

```bash
NIX_CONFIG=$'sandbox = false\nfilter-syscalls = false\nexperimental-features = nix-command flakes'
```

The 16 GB root is too small for `desktop-hermes` (see Evidence). A bigger root also needs more free
disk on the build machine: the image exists about twice during the build, so a 24 GB root needs
about 50 GiB free. 24 GB is a guess and has not been tried.

## Check

```bash
OTEHON_VM_CPUS=8 OTEHON_VM_MEMORY=12288 \
  nixos/otehon/desktop-login-check-qemu.sh desktop-hermes.qcow2 serial.log shot.ppm 3600

# Negative control: the same check with the terminal toolset on. It must exit 1 at agent_no_terminal.
OTEHON_VM_CPUS=8 OTEHON_VM_MEMORY=12288 \
  nixos/otehon/desktop-login-check-qemu.sh desktop-hermes-terminal.qcow2 serial.log shot.ppm 3600
```

Exit codes: `0` every step passed, `1` a step failed or no result before the timeout, `3` the check
could not run. The driver runs the sign-in steps first and then these, through the real shell:

| Step | Model | Passes when | Control |
| --- | --- | --- | --- |
| `agent_connected` | Real | The notice says connected | `agent_model_down` and `agent_down` must bring the "no agent" notice back |
| `agent_real_answer` | Real | The capital of France comes back as Paris, and llama.cpp logged a prompt | A failed turn or another answer fails the step |
| `agent_wrong_key` | Real | Wrong or missing key gets 401, and the shell shows the refusal | The right key gets 200 |
| `agent_bad_origin` | Real | `https://evil.example` and `file://` get 403, and a preflight from evil gets 403 | Origin `null` gets 200 |
| `agent_context` | Double | The system message Hermes sends holds the app | |
| `agent_saifu_call` | Double | A scripted Saifu call returns its result | Shows that scripted calls do run, so a refused terminal call means something |
| `agent_no_terminal` | Double | A scripted `terminal` call does not create its file, and no terminal or file tool is offered | `desktop-hermes-terminal` must fail here, with `ran=1` in the log, because the call is tried before the tool list is checked |
| `agent_model_down` | None | With no model, the notice returns and the message fails | |
| `agent_down` | Double | With Hermes stopped, the shell says it cannot be reached | |

"Double" is `nixos/otehon/hermes-test-double.py`, a scripted stand-in **that is not inference**. It
is only in check images, and it takes the model's port under the same Hermes process and
configuration. It exists because a real small model cannot be made to emit a chosen tool call.

The driver also asks the real model to use the Saifu tool and logs what happens. That is an
observation and does not fail the check, because a small model may not choose to call a tool.

## Evidence (2026-11-07, Apple M1 Max, 5 vCPU aarch64 Linux container)

| What | Result |
| --- | --- |
| Hermes package build | Exit 0 in 14m40s. Store path `a9mh3y1flkv2a4p7178c5bvb27blha83-hermes-agent-0.0.0` |
| Hermes closure | 3.3 GiB, before the model (about 1 GiB) |
| `desktop-hermes` system closure | Builds. `5lw4lnhikyih85k5n9pcwdbjsniama4k-nixos-system-awai-otehon-26.05pre-git`, 11.5 GiB (`nix path-info -S`). Building it runs the shell's `npm test`, agent tests included |
| Shell unit tests for the agent client | `node --test test/agent.test.js`: 4 pass, 0 fail |
| `desktop-hermes` image | **Not built.** The first try filled the host disk. A retry got `NOT_RUN only 14823496KiB free, need 30GiB`, exit 3, from `vm-lock.sh`. The next try got `mkfs.ext4: No space left on device while populating file system`, exit 1 (`.agent-output/build-desktop-hermes.err`, line 155): the 11.5 GiB closure does not fit the 16 GB ext4 root |

A smoke test ran in the Nix container, with no VM, no shell and **no real model**: Hermes, the test
double and the real Saifu server on Basilisp, using a hand-written copy of the configuration.

| Case | Result |
| --- | --- |
| Tools Hermes offered the double | Exactly `mcp__saifu__saifu_format_wei`, `mcp__saifu__saifu_hex_to_decimal`, `mcp__saifu__saifu_valid_address` |
| Scripted Saifu call | Log: `tool mcp__saifu__saifu_format_wei completed (0.02s, 32 chars)`. The double's next request held a tool result for it. The returned value was not read, because the log line was cut |
| Scripted `terminal` call | Tool result: `Tool 'terminal' does not exist. Available tools: ...` |
| Wrong key on `/v1/models` | 401 |
| `https://evil.example` origin with the right key | 403 |
| Preflight from origin `null`; `/v1/models` from origin `null` with the right key | 200; 200 |
| Saifu server startup with namespace caching off | Registered about 11 s after it started (08:22:35 to 08:22:46). In a later run the Hermes health check passed at 13 s |

### What earlier runs got wrong

- By default Hermes hides MCP tools behind `tool_search`, `tool_describe` and `tool_call`, so the first smoke run offered only those three. A `terminal` call failing there proved little, because a bridge is another way to reach a tool. The bridge is now off with `tools.tool_search.enabled = "off"`. The double also had the wrong tool name in that run: Hermes names it `mcp__saifu__saifu_format_wei`.
- Hermes makes an extra request to the model for a session title, which costs a slow model time. It is now off with `auxiliary.title_generation.enabled = false`.
- A second smoke run with the terminal toolset on showed nothing: the first gateway was still running and every request got `gateway_draining`. So **nothing here shows that the terminal negative control fails as it should**.
- The disk: `vm-lock.sh` passed with about 21 GB free, and by 17:39 the Mac had about 118 MB free. The podman machine's disk had grown to 91 GB on the host, and the machine stopped accepting connections. The 16 GB root image is a likely cause. Other sessions were also using the disk, so the share from this build is not known.

## Not verified or not implemented

- **Everything in the Check section.** No VM has booted this. An answer through the real shell, the refusals through the real shell, `key.js` loading from `file:///run` under the page's CSP and the systemd settings have not been seen working.
- **A real model answering Hermes.** llama.cpp has not run with this model, so its speed and whether it answers correctly are unknown. Hermes making a tool call from a real model's output has not been seen.
- The terminal negative control has never produced a failure.
- The image size, and what root size is enough. 16 GB is not; 24 GB is untested.
- `desktop-agent` has not been built or evaluated.
- Whether `IPAddressDeny` stops an actual outgoing connection. These VMs have no network adapter.
- llama.cpp has no key on loopback. Any local process, and any page in the browser, can use the model. Hermes itself needs the key.
- Hermes keeps its session files in its state directory, and they are never removed.
- Physical hardware and x86_64.

## Blockers

- **Root size and disk space for the build.** The 11.5 GiB closure does not fit the 16 GB ext4 root (`mkfs.ext4: No space left on device`). A bigger root needs more free disk: the image exists about twice during the build, so a 24 GB root needs about 50 GiB free, and the Mac does not have that now. 24 GB is untested. The root size and `vm-lock.sh` are unchanged; the image build waits until the owner frees disk. The podman machine was restarted and trimmed by the coordinator. `nix-store --verify` printed no errors, and `--check-contents` was not run.
- **The registry's `mihari` and `dandori` servers need `kbb`.** In `cloud-itonami/itonami-registry` `f107a79ba`, `mcp/mihari/manifest.json` and `mcp/dandori/manifest.json` have `"command": "kbb"`. ADR 0026 D3 does not allow it here, so they are not added. Generating `mcp_servers` from the registry (D14) is also not done: the Saifu entry is written by hand.
