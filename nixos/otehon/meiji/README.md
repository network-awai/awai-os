# Meiji desktop — AWAI-195

Tauri **3.0 Alpha** opens the existing Soshiki UI and carries bounded JSON
requests to a `.cljc` Otehon host controller. Rust contains IPC/process plumbing;
policy, lifecycle, persistent limits, inference adapters and UI are `.cljc`.
This is the Otehon development implementation, not the `cljrs` AOT release target
in ADR 0031 D11 and not a Kotoba/Amu native profile fallback.

## Build locally

From this directory, with Babashka, Node/npm, Clojure and Rust >= 1.95 installed:

```sh
npm ci --prefix ../shell
npm ci
bb test
npm run build:ui
cargo check --manifest-path src-tauri/Cargo.toml
```

Pin verification: `Cargo.lock` and `package-lock.json` are committed. Direct
crates are `tauri=3.0.0-alpha.6`, `tauri-runtime-wry=3.0.0-alpha.6`,
`tauri-build=3.0.0-alpha.4`; CLI is `3.0.0-alpha.6`. These packages have distinct
release numbering. Do not replace them with v2 or an unpinned `next` tag.

Stage the **target's** verified Babashka binary as `src-tauri/bin/bb` (`bb.exe`
on Windows), retain its license, then `npm run bundle -- --bundles app` on Mac
(use the target's supported installer elsewhere). The local Mac candidate used
Babashka 1.12.218. Cross-platform signed packaging and a Nix-pinned release
closure remain unqualified. The circle icon is a development placeholder.

## Owner configuration

Copy/adapt `example.edn` to `meiji.edn` in Tauri's platform `app_config_dir()`
for identifier `network.awai.meiji` (the native resolved path is authoritative).
First launch creates an empty catalog. It never discovers/adopts live VMs.
The adjacent `state/` holds the single-controller lock, working disks and
durable `limits.edn`. Preserve these during upgrades. Invalid/unreadable state
is an error, never an instruction to reset it.

In debug builds only, `MEIJI_CONFIG_DIR` can select a separate test directory
and `MEIJI_BB` can select an absolute development runtime. Release builds use
the bundled runtime and platform application directory; no PATH fallback.

Each owner-approved VM has a fixed executable, CPU architecture, firmware,
base image SHA-256, detached minisign signature, trusted public key, resource
ceiling and explicit inference provider. The UI supplies only operation, ID
and typed CPU/RAM limits. No arbitrary commands/extra flags, filesystem or
endpoint browsing are exposed to WebViews. The release image/key provisioning
UI and signed download flow are not implemented here.

Supported launch plans: same-architecture QEMU/HVF on Mac, QEMU/KVM on Linux,
QEMU/WHPX on x86_64 Windows, and raw-image Krunkit on Apple Silicon. No TCG or
WSL fallback. Hyper-V native API integration remains future work. A missing
backend, incompatible architecture, digest/signature failure or process exit
fails closed. No host port is opened by the controller or QEMU plan; guests
have outbound user-mode networking. No host directories or PCI devices are
implicitly shared.

The signed base is copied once into an owned working disk. An existing disk
without the matching provenance record is preserved and refused. Changing
the base digest does not silently replace/migrate a working disk. CPU/RAM
limits are guest allocations, **not** measured host RSS or a host CPU duty
cycle quota; hard CPU duty-cycle/disk/bandwidth limits remain release work.

QEMU stop requests `system_powerdown` over private QMP stdio and reports
`stopping` until the process exits. It does not automatically escalate.
Krunkit currently has only the separately labeled force-stop action; graceful
guest shutdown and lease-drain integration remain open. Force-stop can lose
unflushed guest work. App exit is blocked while a managed VM is running;
the controller closes children on EOF. A hypervisor start is not guest boot,
Bot liveness or restored application state.

## GPU inference and Soshiki

The explicit host-local adapter calls `/v1/chat/completions` on a configured
literal loopback origin, without redirects, with a fixed short probe and
`max_tokens=4`. There is no remote or CPU fallback. Providers are selected by
VM configuration, not by UI URLs. macOS accepts Metal/Vulkan, Linux
CUDA/ROCm/Vulkan, Windows CUDA/DirectML/Vulkan; the actual selected engine must
provide the compatible protocol. Existing Murakumo/Mishima inference rails
are not switched or provisioned by the launcher. A successful response shows
`responded`, with **GPU use unknown** until independent device/runtime
measurements qualify it. This adapter does not move the host worker into the
VM or grant it a sandbox. VM-internal GPU inference is a separate route;
Krunkit/Venus remains experimental.

Set `reports-dir` to an existing **public observation directory** maintained
by the fleet observer. Only five named JSON files may be read: fleet state,
agent presence, peer cycles, Circle work and mail executor progress. The
original JSON text is preserved so Soshiki verifies its existing envelope
digest and freshness checks. Stale/missing reports stay unknown. Nothing
copies transcripts, credentials or keys into the app bundle. The Tauri UI
reads these files directly via IPC without a local HTTP application server.

UI/workflows remain in the local WebView. Tauri ACLs, host administration,
Bot executor grants and the canonical Kotoba operation broker stay distinct.
The initial desktop CSP intentionally allows only local assets/IPC: remote
conversation operations, dapp frames and external browser service operations
are not qualified by this launcher change and cannot silently bypass the
shared consent broker. Existing browser deployments are unchanged.

## Validation boundary (2026-11-16)

- Babashka 1.12.218: 7 tests, 63 assertions. Five GPU backend names were tested
  against a loopback protocol fixture, **not five physical GPUs**.
- Existing shell: 97 tests pass. Shell/link/Soshiki ClojureScript release
  builds pass without compiler warnings.
- Mac arm64: Tauri v3 Cargo check and local debug `.app` build pass.
- Real Mac QEMU/HVF, disposable blank signed qcow2: signature success, bad
  digest/signature refusal, hypervisor start, duplicate start refusal,
  running-limit refusal, stop and durable limit reload pass. This is not a
  Meiji guest boot, distributed fleet or GPU inference acceptance result.
- Existing live fleet, cron, identities, mail routing and authentication are
  not modified by the validation. The existing unsigned Meiji image is not
  adopted and its working disk is not overwritten.

Remaining: current-head UI/native IPC acceptance, signed release image
provisioning, pinned runtime license/digest packaging, cljrs qualification,
Linux/Windows device runs, actual GPU/model responses and GPU-use evidence,
Krunkit graceful stop/lease drain, distributed state recovery, code signing,
notarization and installer/update qualification. Track in AWAI-195; build,
merge, deployment and operational acceptance are separate claims.
