# Sanka core

The pure core of Sanka (参加), where a person or a bot takes part in the Bot economy, with a receipt
verifier. This is stages V0 and V1 of `network-awai/network-awai-apex` ADR 0027 (AWAI-177). It has
no screen, service, keys or ledger, and it is **not built into the OS image**.

| Part | File | Runs on |
| --- | --- | --- |
| Pure core | `src/sanka/core.cljc` | ClojureScript, Babashka and Basilisp, unchanged |
| Shared runner | `test/sanka/runner.cljc` | The same three |
| Platform entry points | `test/run_cases.cljs`, `.clj`, `.lpy` | One each |
| Shared data | `test/cases.json`, `test/scenarios.json` | All of them |
| Data generator | `test/gen_cases.lpy` | Basilisp, only to rewrite the JSON |
| Receipt verifier | `tools/verify_receipt.lpy` | Basilisp with `cryptography` |
| Real order and attacks | `test/live_v1.py` | Python, driving real processes |

## What the core decides

- **Orders.** `check-order` refuses unknown fields, an order to yourself, a node as the payee, and
  any `live` order. Only `compute` is open. `storage` and `human` wait for their own gates.
- **Receipts.** `check-receipt` compares a receipt with pins from the order. The fields are a closed
  set, so a prompt or an output has nowhere to go, and the input must be a hash under the order's key.
- **Acceptance.** `check-acceptance` refuses a provider or node judging its own work.
- **States.** `transition` and `walk` follow ADR 0027 D6. A missing fact is not a yes: approval needs
  a person, a reservation needs a known balance, and nothing leaves `submitted` by submitting again.
- **Display.** `balance-view` shows an unknown balance as `unknown`, never as 0. `total` refuses to
  add different assets or value classes.

The core does no hashing or signature checks. The host verifies those and passes the result in as
a pin or a fact, so a host that lies about a fact defeats the core.

## Check

From this directory, `nix/shell.nix` gives Babashka and Basilisp. The pinned nixpkgs has no `nbb`,
so nbb comes from outside the pin.

```bash
nix-shell nix/shell.nix --run 'bb --classpath src:test test/run_cases.clj'
```

```bash
PYTHONDONTWRITEBYTECODE=1 nix-shell nix/shell.nix --run 'PYTHONPATH=src:test basilisp run test/run_cases.lpy'
```

```bash
nbb --classpath src:test test/run_cases.cljs
```

Basilisp writes bytecode beside its sources unless `PYTHONDONTWRITEBYTECODE=1` is set, and the Nix
store is read-only, so it fails without it.

The `Sanka VM gate` workflow runs the first two and then `nixos/tests/sanka-v1.nix`. It is an
Otehon job, not a required check, and the native profile does not depend on it.

The generated JSON is checked in. To change a case, edit `test/gen_cases.lpy` and run `basilisp run test/gen_cases.lpy`.

## Evidence (2026-11-07, Apple M1 Max, macOS host)

Versions: nbb 1.4.208 on Node 26.0.0, Babashka 1.12.218, Basilisp 0.5.1 on Python 3.13.5.

| Check | Result |
| --- | --- |
| 398 cases and 14 scenario pairs on all three | 426 of 426, exit 0 |
| Every state the table can reach | Reached by a scenario, or the run fails |
| One changed expectation | 1 failure on all three, exit 1 |
| Core changed to allow paying before acceptance and to ignore an unknown balance | 5 failures on all three, exit 1 |

Each order, receipt and acceptance case changes one field of a good document. Each scenario pairs a
correct walk with the walk that has to be refused in the same situation.

## A real order (stage V1)

`test/live_v1.py` starts `llama-server` and the Hy gateway from
`network-awai/cloud-kotoba-desktop` (`gateway-hy/kotoba_gateway/orders.hy`), runs an order, and then
tries to break it. `tools/verify_receipt.lpy` shares no code with the gateway. It works out the CIDs,
the keyed input hash and the signature itself.

Evidence: [`docs/evidence/sanka-v1-20261107.json`](../../docs/evidence/sanka-v1-20261107.json), from
llama.cpp 0.7.0 and `stories15M-q4_0.gguf` on an Apple M1 Max, on the macOS host.

| Check | Result |
| --- | --- |
| Whole run | 29 of 29 checks |
| The verifier accepts the real receipt, and agrees with the gateway on both CIDs | Yes |
| A changed output, padded measurement, forged signature, other request, wrong key, other order, or receipt carrying the prompt | Each refused by the verifier |
| A used or unknown key, another model, a live order, another node, or an engine serving another file | Each refused by the gateway |
| A restart | The receipt reads back the same, and the key stays spent |
| Files the provider keeps | No prompt, output or key |
| Gateway changed to lie about the output and keep plain text | 3 checks fail, exit 1 |

The demand class is `replay`, because this is a test and not real demand. The order has no value and
moves nothing. The model is a small test model, so its text is not a useful answer.

### In a NixOS VM (2026-11-07, GitHub Actions)

`nixos/tests/sanka-v1.nix` runs the same harness in a NixOS VM with no network, on an x86_64 GitHub
Actions runner with KVM. The gateway is pinned to `cloud-kotoba-desktop` `1f8fe2b`, and the engine is
nixpkgs llama.cpp 9190, not the 0.7.0 used on the host.

Evidence: [`docs/evidence/sanka-v1-vm-20261107.json`](../../docs/evidence/sanka-v1-vm-20261107.json),
from [run 42351054943](https://github.com/network-awai/awai-os/actions/runs/42351054943).

| Check | Result |
| --- | --- |
| Babashka and Basilisp on Nix | 426 of 426 each |
| The VM reaches `huggingface.co` | No |
| Whole run | 29 of 29 checks, 24 completion tokens |
| Gateway changed to lie about the output and keep plain text | 3 checks fail, exit 1 |
| VM step | 861 seconds |

Each run takes about 410 seconds, although the measured inference is under a second. Where the time
goes is not measured.

### What V1 does not show

- No Otehon image was built. The VM is a test machine, not a complete Awai Node, and it is x86_64,
  while the earlier Otehon VMs were aarch64.
- The gateway checks file digests and the path the engine reports. It does not attest what the engine
  really ran, and a dishonest provider could fake a receipt.
- One order allows one call, so a Hermes turn that makes several calls does not fit yet (V2).
- Everything ran on one machine under one operator, so nothing here shows independence.

## Not verified or not implemented

- The macOS evidence above used tools from Homebrew, the user's bin directory and a local `uv`
  environment, not `nix/shell.nix`.
- nbb is not in CI, because the pinned nixpkgs has no `nbb`.
- No screen, signer or ledger uses this core yet. Only the verifier does.
