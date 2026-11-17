# Murakumo model manager and device usage — research and recommendations (2026-11-18)

Tracking: [AWAI-3203](https://linear.app/kotobalabs/issue/AWAI-3203) (parent) and
[AWAI-3204](https://linear.app/kotobalabs/issue/AWAI-3204) (this unit).

Owner direction (2026-11-18): take LM Studio as the reference for Murakumo. Murakumo should add a
model list, download and load, and show which model is loaded. It should visualize RAM, CPU, GPU and
disk use per device, and summarize which model is best on each device.

Owner decisions the same day:

- **Scope:** every device, not only the Android device in hand. Mac nodes such as benjamin report
  their usage, and the view lists devices side by side.
- **Download:** Murakumo gains the INTERNET permission. It fetches only pinned revisions and digests
  from Hugging Face, after a fresh native consent for each download. A digest mismatch is discarded.
- **Design:** Figma first, then implementation, then a comparison of rendered screens (the
  design-first contract in `AGENTS.md`).

This document is research and a proposal. No code, design or device change comes with it.

## 1. LM Studio features and their Murakumo counterparts

Checked against LM Studio's official documentation (`lmstudio.ai/docs`, `lmstudio.ai/llms-full.txt`)
on 2026-11-18. Features not found there are marked as such.

| LM Studio | Where it is documented | Murakumo counterpart |
| --- | --- | --- |
| Discover tab: download any supported model from Hugging Face; `lms get <model>` | docs/basics/download-model, CLI | Model list from a **signed, pinned catalog** (not free search). A download is an external operation needing consent per operation (workspace architecture contract) |
| Several quantizations of one model (for example `Q3_K_S`, `Q8_0`); "choose 4-bit or higher if your machine can run it" | download-model page | Each catalog entry pins one file (repo, revision, bytes, SHA-256); quantization is shown as a field |
| `lms ls`: models on disk | CLI | "On this device" section: admitted files with their digest state |
| `lms load [--gpu] [--context-length]`; per-model default load settings (GPU offload, context, Flash Attention) | CLI, My Models | Load with an explicit context length within the app's bounds. GPU offload applies to Mac nodes; the Android engine is CPU-only today |
| `lms load --estimate-only` prints estimated GPU and total memory before loading | CLI 0.3.27 | **Fit estimate before download and before load** (section 3), shown as comfortable / tight / does not fit |
| `lms ps` (`--json`): models loaded in memory, with generation status and queued requests | CLI | "Loaded" state per device: model, context, busy or idle, since when |
| `lms unload [--all]`; idle TTL and auto-evict (`--ttl`) | CLI, docs article | Release (exists today). Idle TTL is a later option; Android lifecycle may also end the process |
| LM Link: use models on another device over an end-to-end encrypted network (Tailscale); a preferred device; loads routed to the device that holds the model | LM Link docs, `lms link` | **All-devices view**: each node reports usage; inference on another device stays a separate consented operation (ADR 0037), never a silent fallback |
| A RAM / CPU / GPU usage display | **Not found** in the documentation read | Device usage view (section 4), a Murakumo requirement in its own right |
| Model loading guardrails (named levels) | **Not found** in the documentation read | The fit estimate and the app's own hard bounds act as guardrails |

## 2. Devices

The Mac rows were measured on 2026-11-18 with read-only SSH probes (`sysctl`, `sw_vers`,
`df`, `memory_pressure`, `system_profiler SPDisplaysDataType`). The other rows come from the
records cited.

| Device | CPU / GPU | Memory | Free disk | Engine path today | Source |
| --- | --- | --- | --- | --- | --- |
| benjamin | Apple M4, 10 cores (GPU integrated) | 16 GiB unified | 151 GiB | llama.cpp `9581154a` built for macOS (ADR 0027 V2/V5) | Probe 2026-11-18; memory 90 % free |
| jacob | Apple M4, 10 cores | 16 GiB unified | 79 GiB | Owner-selected Kapitsa route (AGENTS.md) | Probe 2026-11-18; memory 62 % free |
| levi | Apple M4, 10 cores (2026-11-12 record) | 16 GiB | 156 GiB (2026-11-12) | — | **Did not answer on 2026-11-18**; values from the C1 preflight record |
| Owner workstation | Apple M1 Max, 10 CPU / 32 GPU cores | 32 GiB unified | — | Not a serving node (see section 5) | Local probe |
| AOSP emulator | arm64, 4 vCPU, CPU only | 3 GiB (AVD config) | 6 GiB data partition | Android Murakumo, llama.cpp CPU | AVD config; AWAI-3011 measured 745,823 KiB PSS with the model loaded |
| moto g05 | Arm SoC, CPU path | **unknown** (not recorded) | unknown | Android Murakumo | `android/device-qualification-20261116.md`; RAM not recorded |
| 6600H PC | AMD Ryzen 5 6600H, Radeon iGPU | **unknown** | unknown | Android (held by another task) | No RAM record; the device is reserved by AWAI-2992 |

## 3. How fit is estimated

The estimated memory to load a model is:

`file size + KV cache + about 0.3 GiB of compute buffers`

The KV cache is per token = 2 (K and V) × layers × KV heads × head dim × 2 bytes (f16), taken from
each model's `config.json` on Hugging Face.

| Model (official Qwen GGUF) | File | SHA-256 (prefix) | Layers / KV heads | KV per token | Est. at ctx 2048 | ctx 4096 | ctx 8192 |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: |
| Qwen3 0.6B Q8_0 | 639,446,688 | `9465e63a…` | 28 / 8 | 112 KiB | 1.11 GiB | 1.33 | 1.77 |
| Qwen3 1.7B Q8_0 | 1,834,426,016 | `061b54da…` | 28 / 8 | 112 KiB | 2.23 | 2.45 | 2.88 |
| Qwen3 4B Q4_K_M | 2,497,280,256 | `7485fe6f…` | 36 / 8 | 144 KiB | 2.91 | 3.19 | 3.75 |
| Qwen3 8B Q4_K_M | 5,027,783,488 | `d98cdcbd…` | 36 / 8 | 144 KiB | 5.26 | 5.54 | 6.11 |
| Qwen3 14B Q4_K_M | 9,001,752,960 | `500a8806…` | 40 / 8 | 160 KiB | 9.00 | 9.31 | 9.93 |
| Qwen3 30B-A3B Q4_K_M (MoE, 3B active) | 18,556,685,824 | `0d003f66…` | 48 / 4 | 96 KiB | 17.77 | 17.96 | 18.33 |

Sizes and digests are from the Hugging Face API (`/api/models/<repo>/tree/<revision>`), read on
2026-11-18. Full digests and revisions get pinned in the catalog (stage 3), not in this table.

**The estimate is conservative where it can be checked.** AWAI-3011 measured 745,823 KiB total PSS
with Qwen3 0.6B loaded at ctx 2048 on the emulator. The estimate is 1.11 GiB, because llama.cpp
memory-maps the weights and touches only part of the file.

**Budgets (a proposal, replaced by measurement in stage 6):**

| Device class | Budget for one model |
| --- | --- |
| Android | 40 % of total RAM: the OS, the shell and other apps share memory, and the low-memory killer ends processes without warning |
| Mac 16 GiB | 10 GiB: Metal's recommended working set on 16 GiB is about two thirds of RAM |
| Mac 32 GiB | 21 GiB |

**Fit levels:**

- **comfortable:** the estimate is at most 80 % of the budget.
- **tight:** the estimate is at most the whole budget.
- **does not fit:** anything above that.

## 4. Recommendations (estimates, not yet measured)

| Device | Default | Faster / lighter | Higher quality | Does not fit |
| --- | --- | --- | --- | --- |
| benjamin, jacob, levi (M4, 16 GiB) | **Qwen3 8B Q4_K_M**, ctx 4096 (5.5 GiB, comfortable) | Qwen3 4B Q4_K_M (3.2 GiB): short agent turns and tool calls | Qwen3 14B Q4_K_M (9.3 GiB, **tight**): only when the node is otherwise idle | Qwen3 30B-A3B |
| Owner workstation (M1 Max, 32 GiB) | Qwen3 14B Q4_K_M (comfortable) | Qwen3 8B Q4_K_M | Qwen3 30B-A3B Q4_K_M (18.0 GiB, **tight**; MoE with 3B active, so decoding is fast for its quality) | — |
| AOSP emulator (3 GiB) | **Qwen3 0.6B Q8_0**, ctx 2048 (tight on estimate; 0.71 GiB measured) | — | — | Qwen3 1.7B and above |
| moto g05 (RAM unknown) | Qwen3 0.6B Q8_0, the only catalog model under 1.5 GiB | — | — | Qwen3 1.7B and above unless it has at least about 5.6 GiB RAM (2.23 GiB ÷ 40 %) |
| 6600H PC | **unknown** until its RAM is recorded | | | |

Reasons:

- **8B on the M4 nodes:** it leaves about 4.5 GiB of the budget for a longer context or a second,
  small model, and it is the largest dense Qwen3 that stays comfortable. 14B fits only with little
  headroom, so a fleet view should warn before it is loaded.
- **0.6B on Android:** 1.7B Q8_0 needs about 2.2 GiB, more than 40 % of a 3 GiB device. The official
  repository publishes no smaller quantization for 1.7B; a third-party Q4 would need its own
  provenance review before it enters the catalog.
- **The owner workstation:** listed for completeness. The owner said not to start Kapitsa there, and
  this document does not propose serving from it. Running llama.cpp there needs the owner's
  decision.
- **Speed is unknown.** No tokens-per-second figure was measured for any of these on any device.
  Stage 6 measures it, and the recommendation may change. For example, 4B may be preferred over 8B
  on the M4 nodes if its quality is enough for most requests.

## 5. Proposed stages (one PR each)

1. **This document.**
2. **Figma states** in the existing Murakumo file, next to model lifecycle node 252:3: catalog list
   with fit badges, download consent, downloading / verifying / failed, on this device, loaded,
   device usage, the all-devices list, and recommendation. Phone and tablet widths; Japanese and
   English.
3. **Shared `.cljc` domain** with Babashka, Basilisp and nbb cases:
   - the catalog schema (pinned repo, revision, file, bytes, SHA-256, layers, KV heads, license);
   - `awai.murakumo.device-usage.v1` snapshots (RAM total/used, CPU %, GPU when measurable,
     disk free, loaded model, observed-at);
   - the fit function and the recommendation. Unknown stays unknown, never 0.
4. **Android Murakumo:**
   - the catalog list;
   - the per-download native consent showing the endpoint, file, size and digest;
   - a streamed download with digest admission;
   - loading any admitted model, and the loaded state;
   - this device's usage (ActivityManager, `/proc` CPU, StatFs);
   - INTERNET added only for the declared Hugging Face origin and its redirect set. The CDN
     redirect must be declared narrowly, per the client-runtime contract.
5. **Mac node usage reports and the all-devices list:**
   - each node publishes a signed snapshot over the existing SSH/tailnet path;
   - the view shows stale or missing reports as stale or unknown;
   - reading another device is a consented operation;
   - no remote inference is started from the list.
6. **Measurement:** tokens per second and peak memory for each recommended model on each device,
   then the recommendation table updated from measured values.

## 6. Unknown or not checked

- levi did not answer on 2026-11-18.
- RAM of moto g05 and the 6600H PC.
- Any speed figure.
- GPU utilization: macOS exposes it without root only partly, and the Android engine does not use
  the GPU.
- Whether Hugging Face's download redirects can be declared narrowly enough for the client-runtime
  contract. Stage 4 checks this before adding INTERNET.
