# Meiji desktop and jacob inference — 2026-11-16

Tracking: [AWAI-195](https://linear.app/kotobalabs/issue/AWAI-195).
Implementation: [PR #144](https://github.com/network-awai/awai-os/pull/144),
stacked on #95; merge, release signing and platform acceptance remain separate.

## Implemented and observed

- Tauri **3.0 Alpha** entry, exact crate/package locks; existing Soshiki UI.
- `.cljc` lifecycle policy, private stdio controller, owned VM start/stop,
  durable vCPU/guest RAM allocation, signed-base-image checks, report IPC and
  explicit GPU provider selection. Rust is the Tauri/process bridge.
- Mac QEMU/HVF: real disposable signed blank disk start/stop, bad signature
  and digest refusal, duplicate start refusal, running-limit refusal and
  persistent-limit reload. This does not establish a Meiji guest boot.
- Native Tauri window rendered the existing 899-Bot catalog, VM controls and
  the selected `jacob · metal` provider. VM Start was observed. UI automation
  later lost WebView accessibility frames and timed out; GUI Stop/limit edit
  and clicking the inference button are not accepted by that observation.
- Existing public fleet envelope was verified after real controller stdio
  transport. Its source observation was `2026-11-13T12:15:28.215Z`, so the UI
  displays it as stale. Reading it does not create new Bot liveness evidence.
- Local `.cljc` tests: 12 tests / 105 assertions. CPU/protocol fixtures are
  distinct from GPU execution. The Linux Nix-pinned Otehon check passed at
  `206e3eaeabcf3667c84e1e472b2d772a5e244ab4`; later commits need their own CI.

## jacob deployment

Owner selected jacob and explicitly prohibited Kapitsa on the local owner
workstation. Local engine execution is stopped/disabled; no local Kapitsa
LaunchAgent exists. Existing downloaded artifacts were preserved.

jacob was verified as Apple Silicon with 16 GiB unified memory, account
`node`. The existing global Kapitsa 0.2.31 was preserved. A separate Meiji
capsule uses the official Kapitsa **0.2.36** artifact (release SHA-256 in the
Meiji README) and `.cljc` worker sources at `206e3ea`.

The explicit model is `qwen3.6-35b-a3b:16gb`, pinned to GGUF source revision
`a483e9e6cbd595906af30beda3187c2663a1118c` and source SHA-256
`2e8f5f705355c56311432d0a8a5d14a696dbb7e4b197d05c75ba805fc1857bef`.
The pinned engine imported the 10.76 GB GGUF into 12.69 GB of native-layout
files. Nine generated model/metadata files received SHA-256 baselines.
This mixed-quantization pack is not claimed numerically equal to the 4-bit
pack used in the earlier local investigation.

LaunchAgent `network.awai.meiji.kapitsa` runs under the logged-in jacob user.
It has a separate port, private token/config/log directory, single-worker
file lock, failed-exit restart policy and 60-second throttle. It listens only
on **127.0.0.1:18095**, with `private=true`, `local=true`, no peers, model
switching disabled, one slot, context 2048 and disk prefix cache disabled.
The desktop connects over an owned SSH forward using existing authentication
and strict host-key checks. API credentials are private files, not UI values,
argv, environment variables, Linear content or Git artifacts. No public
inference port or Tailscale Serve route was added.

## Actual inference receipt

At `2026-11-16T06:59:15.841477Z`, the Meiji adapter on the desktop called
jacob through that SSH forward. The configured model responded successfully
to the fixed short probe:

| Measurement | Observed value |
|---|---:|
| HTTP request duration | 542 ms |
| Input tokens | 15 |
| Output tokens | 3 |
| Total tokens | 18 |
| Cache-read tokens | 0 |
| Engine-reported prefill | 344.3 ms |

The service then received SIGTERM and launchd restarted its wrapper
(PID 60895 → 61335). The private API token remained unchanged. A second
authenticated call at `2026-11-16T07:05:21.651830Z` succeeded in 485 ms,
with 15 input / 2 output / 17 total tokens and zero reported cache reads.
Across these two explicitly bound successful validation calls: 30 input,
5 output, 35 total tokens. No benchmark rate is inferred from them.

The timer excludes SSH setup. This is one short validation call, not a
throughput benchmark or fleet-wide latency claim. Reasoning/cache-write and
energy/cost measurements are unknown. The response reports `gpu-use=unknown`:
the Metal engine is selected and running on jacob, but hardware utilization
counters were not measured. Protocol-fixture token numbers are excluded.

Coding-session model/settings/token totals remain unknown/unallocated;
the local inference receipt above is explicitly bound to AWAI-195 and is not
added to a parent rollup twice.

## Remaining acceptance

A LaunchAgent qualifies
logged-in operation, not FileVault pre-login execution or physical reboot.
Full Bot cron migration onto a new Meiji VM, lease drain, signed release
image provisioning, distributed state recovery, `cljrs` AOT, Windows/Linux
device runs, installers/notarization and full UI acceptance remain open.
The existing fleet, cron, passkeys, DID/key custody and mail routing were not
reconfigured by this deployment.
# Follow-up: native workspace isolation and live readback

2026-11-16 07:35–07:37 UTC, AWAI-195 / AWAI-2820:

- Reproduced a WebKit content process at over one CPU core after the dense
  fleet view loaded; native accessibility interactions timed out. This is an
  observation, not a measured root-cause diagnosis.
- The Tauri entry now mounts either VM controls or Bot/Circle workspace.
  VM controls remain responsive while the fleet workspace is unmounted.
  Browser entry behavior is unchanged. Fleet workspace performance still needs
  separate qualification; workspace isolation does not prove it is fixed.
- Through the actual Tauri v3 window, saved the disposable fixture's allocation
  from 1 CPU / 512 MiB to 2 CPUs / 768 MiB, started it, observed `running`, sent
  graceful stop and observed `stopping`, then explicitly force-stopped it and
  observed `stopped`. The blank fixture has no guest OS to acknowledge ACPI.
  This proves the control path, not a production guest's clean shutdown.
- A native UI inference check returned `responded` through the configured SSH
  tunnel to jacob's Metal Kapitsa worker. GPU utilization remains unknown.
  No Kapitsa engine was started on the owner's Mac.
- Quit/reopened the app and observed the same 2 CPU / 768 MiB allocation in
  the real form; independently read its durable `limits.edn`.
- Local CPU/protocol suite: 12 tests / 105 assertions passed. Shell/Soshiki
  release compilation and Tauri debug app bundle completed. This candidate is
  not a signed release or a production Bot VM adoption.

