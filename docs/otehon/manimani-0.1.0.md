# Manimani 0.1.0

The resident bot under New chat in the Otehon shell (AWAI-180). It is modeled on OpenAI's Dots: an agent that keeps running, remembers, works on a schedule, and reports what it did. It runs on this device, and its inference is local.

| Dots | Manimani | State |
| --- | --- | --- |
| In the sidebar under New chat | The same | Done. Checked in a preview, not in the VM |
| Keeps running between conversations | `otehon-manimani`, restarted by systemd. State survives a restart | Done |
| Own cloud computer | This device. Nothing leaves it | Done, by design |
| Remembers context | `remember` tool, shown and clearable in the shell | Done. The small model rarely calls it |
| Recurring tasks | `schedule` tool. A missed task runs once | Done |
| Hands off deeper work | `delegate` to agents on loopback | Done against a stub. No real agent is connected yet |
| Rules for what needs approval | Each agent is `ask` (the default) or `auto` | Done |
| Activity view, pause | The side panel | Done |
| Voice | Not built yet | See below |
| Reads your connected apps in the background | Not built | Out of this version |

## Boundaries

- **Local only.** The service refuses to start if inference or any agent is off loopback, and systemd denies every other address. There is no remote fallback: with no model, it says so and invents nothing.
- **Other agents' text is data.** The model can ask for a tool, and `manimani.core` decides whether it runs. An unknown tool or agent runs nothing, and nothing runs while paused.
- **No conversation in logs.** Activity records kinds and names, not content.
- **Who may call it.** The `null` origin of the OS page only, with a Host check against DNS rebinding.

Its memory and messages are saved in `/var/lib/otehon-manimani/state.edn`, on the LUKS state of `base-module.nix` where that module is used.

## Model

`qwen2.5-1.5b-instruct-q4_k_m` (Apache-2.0, 1.1 GB, 82 tokens/s on an M1 Max) is a placeholder, and it is not good enough. Asked in Japanese to remember a fact, it replied in Chinese and said "remembered" without calling the tool, so the memory stayed empty. A larger model must be measured on the target machine.

## Voice (not built)

Qwen3-TTS and Qwen3-ASR look like the right pair: both are reported as Apache-2.0 and both cover Japanese. Three things need measuring before they go in the OS:

- **Hardware.** Reports assume an NVIDIA GPU. The target's Radeon 660M has no CUDA, so this may need to run on the CPU, and one report puts the small model at 4 to 8 GB.
- **Streaming.** Sources disagree on whether the official code streams. A third-party fork says it does not.
- **Packaging.** Both use PyTorch, which is large for the image.

The plan is microphone, then Qwen3-ASR, then the Manimani turn, then Qwen3-TTS, all on loopback. If Qwen3 cannot run in real time on the target, tell the owner rather than switching engines silently. Piper refused a Japanese voice in `docs/otehon/media-0.1.0.md`.

## Check

```bash
cd nixos/otehon/manimani
bb -cp src:test test/manimani/core_test.clj
python3 -I test/check_service.py http://127.0.0.1:18772
```

The second needs `llama-server --jinja --port 18772` running with a model.

## Name

`network-awai/app-manimani` is a different thing: a personal knowledge router, with no implemented backend. Routing fragments to projects could become a Manimani agent later.
