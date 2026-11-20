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
| moto g05 | MediaTek MT6768, CPU path | 7.5 GiB (7,911,268 kB, `/proc/meminfo`) | unknown | Android Murakumo | `android/device-qualification-20261116.md`; RAM read read-only over adb on 2026-11-18 (AWAI-3391) |
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

## 4. Recommendations (M4 rows measured on 2026-11-18; the others are estimates)

### Measured on the M4 nodes (stage 6, AWAI-3391)

benjamin and levi (M4, 16 GiB, macOS 26.7.2) ran the pinned llama-server with Metal: ctx 4096, one
request at a time, temperature 0, 128 generated tokens. Each figure is the median of 3 runs after a
warm-up. GPU utilization was 96–99 % in every run, and no run swapped. The two nodes agree within
2 %, except the 4B load time (2.8 s and 7.2 s, a first-read cache effect). Evidence:
[`docs/evidence/murakumo-measure-6-20261118/`](../evidence/murakumo-measure-6-20261118/summary.json).

| Model | Load | Prompt, 1211 tokens | Generation | Memory (lower bound) | Estimate (§3) |
| --- | --- | --- | --- | --- | --- |
| Qwen3 0.6B Q8_0 (benjamin only) | 0.8 s | 2,700 t/s | 109–130 t/s | 1.2 GiB | 1.1 GiB |
| Qwen3 4B Q4_K_M | 2.8–7.2 s | 397 t/s (3.0 s) | 34–37 t/s | 3.1–3.7 GiB | 3.2 GiB |
| Qwen3 8B Q4_K_M | 5.0 s | 218 t/s (5.6 s) | 20.0–20.7 t/s | 5.2 GiB | 5.5 GiB |
| Qwen3 14B Q4_K_M | 11.2 s | 110 t/s (11.0 s) | 11.4–11.7 t/s | 7.2–7.6 GiB | 9.3 GiB |

- **Generation** is tokens per second while decoding; the range covers the 12-, 251- and 1211-token prompts.
- **Memory** is the larger of the server's maximum resident set and the rise in system memory in use.
  Both undercount memory-mapped weights, whose pages are file-backed. So the 14B figure is below its
  9.0 GB file, and the estimate (file + KV + 0.3 GiB) stays the planning number.

### What changes

| Device | Default | Faster / lighter | Higher quality | Does not fit |
| --- | --- | --- | --- | --- |
| benjamin, jacob, levi (M4, 16 GiB) | **Qwen3 8B Q4_K_M**, ctx 4096: 20 t/s, a 1200-token prompt in 5.6 s | Qwen3 4B Q4_K_M: 36 t/s, the same prompt in 3.0 s. For agent turns and tool calls, where prompt time dominates | Qwen3 14B Q4_K_M: 11.6 t/s, the prompt in 11 s, loads in 11 s. Only when the node is otherwise idle | Qwen3 30B-A3B |
| Owner workstation (M1 Max, 32 GiB) | Qwen3 14B Q4_K_M (comfortable, estimate) | Qwen3 8B Q4_K_M | Qwen3 30B-A3B Q4_K_M (18.0 GiB, **tight**) | — |
| AOSP emulator (3 GiB) | **Qwen3 0.6B Q8_0**, ctx 2048 (0.71 GiB measured, AWAI-3011) | — | — | Qwen3 1.7B and above |
| moto g05 (7.5 GiB) | **Qwen3 1.7B Q8_0**, ctx 2048 (estimate 2.2 GiB, comfortable in a 3.0 GiB budget; not measured) | Qwen3 0.6B Q8_0 | Qwen3 4B Q4_K_M (estimate 2.9 GiB, **tight**) | Qwen3 8B and above |
| 6600H PC | **unknown** until its RAM is recorded | | | |

Reasons:

- **8B stays the M4 default.** It generates at 20 t/s, faster than reading speed. Its measured memory
  matches the estimate, and nothing swapped. jacob is assumed to behave like benjamin and levi (same
  model and memory); it was not measured, because it runs the Kapitsa worker.
- **4B for tool loops.** Agent turns resend long prompts. 4B reads them about 1.8× faster than 8B, and
  generates 1.8× faster.
- **14B is usable but slow to start.** Its load (11 s) and 1200-token prompt (11 s) make it a poor
  default. It ran without swap on an otherwise idle node; with another model or a longer context
  loaded, that is not shown.
- **moto g05:** reading its RAM (7.5 GiB) moves its default from 0.6B to 1.7B on the estimate. The shared domain (`recommend`, Android, ctx 2048) gives 1.7B comfortable and 4B tight.
  Android speed and memory were not measured in this stage (owner decision 2026-11-18).
- **Not measured:** concurrent requests, contexts above 4096, the owner workstation and any Android
  device.

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
   - each node publishes a signed snapshot over the existing SSH/tailnet path. As built (AWAI-3377):
     the phone pulls it over Tailscale Serve HTTPS, because the canonical broker accepts only
     `https://` endpoints. See `apps/murakumo/node/README.md`;
   - the view shows stale or missing reports as stale or unknown;
   - reading another device is a consented operation;
   - no remote inference is started from the list.
6. **Measurement:** tokens per second and peak memory for each recommended model on each device,
   then the recommendation table updated from measured values.

## 6. Unknown or not checked

- levi did not answer on 2026-11-18.
- RAM of the 6600H PC (the moto g05 has 7.5 GiB, read on 2026-11-18).
- Speed on Android and on the owner workstation (the M4 nodes were measured in stage 6).
- GPU utilization: macOS exposes it without root only partly, and the Android engine does not use
  the GPU.
- ~~Whether Hugging Face's download redirects can be declared narrowly enough for the client-runtime
  contract.~~ Checked on 2026-11-18 (stage 4b, AWAI-3307):
  - a pinned `resolve/<revision>` answers 302 to `us.aws.cdn.hf.co`;
  - both hops allow CORS and Range;
  - the declaration is the single redirect set `https://*.cdn.hf.co`.
  Android's INTERNET permission is not per-origin, so the narrowing lives in the CSP and the broker.

## 7. Figma proposal (stage 2, [AWAI-3214](https://linear.app/kotobalabs/issue/AWAI-3214))

Made on 2026-11-18 in file `umqCqP5KSjLWh9fhCI1HaN`, page `252:2` (Murakumo · Android Otehon), next to
the existing Murakumo frames 01–08. Those frames, the Otehon baseline (`216:476`) and the
navigation/shell are unchanged. The proposal reuses the file's existing variables (Awai OS brand
colors, Android v2 semantic colors), the `Android v2 / Button` component set and Noto Sans JP at the
existing sizes. Sample data is labelled as a design example (an 8 GiB Android tablet). Other
devices use the values measured in section 2.

| Node | What it shows |
| --- | --- |
| [`293:178`](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=293-178) components | `Murakumo / Fit badge` (`293:187`), `Murakumo / Usage meter` (`293:222`), `Murakumo / Model row` (`293:223`), `Murakumo / Device row` (`293:234`) |
| [`295:200`](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=295-200) 09 · モデル一覧 / この端末 | Catalog with fit badges and the recommendation; this device's loaded model, RAM / CPU / GPU (unknown) / disk; release |
| [`296:376`](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=296-376) 10 · 取得の確認 | Native consent: service, source, file and revision, size, SHA-256 to check, data sent (none), free space after |
| [`296:433`](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=296-433) 11 · 取得中 / 照合失敗 | Download progress with stop; a digest mismatch discarded with retry; what stopping does |
| [`298:690`](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=298-690) 13 · 読み込む / 読み込み中 | Downloaded and verified with a Load action; loading in progress; one model at a time |
| [`295:295`](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=295-295) 12 · 全端末 | Every device: last signed report, loaded model, RAM / CPU / GPU / disk; a device with no recent report shows its age and unknown values |
| [`297:491`](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=297-491) P09 phone (JA), [`297:586`](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=297-586) P09 phone (EN), [`297:677`](https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=297-677) P12 phone | The same states at 411 dp. Model and device rows wrap; the tablet layout is unchanged |

Rules in the design:

- **Labels, not color alone:** each fit badge carries its word (快適 / 余裕少 / 入らない / 不明).
- **Unknown is unknown, never 0:** an unknown value shows a dashed track and 不明.
- **Exact values in text:** the value text holds the exact figure; the bar is approximate.
- **Out-of-reach states are disabled:** a model that does not fit gets a disabled action, and release
  is unavailable while loading.

Not designed yet:

- English versions of the tablet frames 10–13, and phone versions of 10, 11 and 13.
- Light mode.
- The Itonami handoff frame (08).
- How the fleet list asks for consent before reading another device's report: the canonical broker
  dialog is reused, not redesigned.

The proposal stays inside the existing Murakumo app structure, so under the design-first contract
it needs no separate owner design decision.
