# Sanka core

The pure core of Sanka (参加), where a person or a bot takes part in the Bot economy. This is stage
V0 of `network-awai/network-awai-apex` ADR 0027 (AWAI-177). It has no screen, service, keys or
ledger, and it is **not built into the OS image**.

| Part | File | Runs on |
| --- | --- | --- |
| Pure core | `src/sanka/core.cljc` | ClojureScript, Babashka and Basilisp, unchanged |
| Shared runner | `test/sanka/runner.cljc` | The same three |
| Platform entry points | `test/run_cases.cljs`, `.clj`, `.lpy` | One each |
| Shared data | `test/cases.json`, `test/scenarios.json` | All of them |
| Data generator | `test/gen_cases.py` | Python, only to rewrite the JSON |

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

From this directory, with `nix/shell.nix`:

```bash
nbb --classpath src:test test/run_cases.cljs
```

```bash
bb --classpath src:test test/run_cases.clj
```

```bash
PYTHONPATH=src:test basilisp run test/run_cases.lpy
```

The generated JSON is checked in. To change a case, edit `test/gen_cases.py` and run it.

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

## Not verified or not implemented

- `nix/shell.nix` was not run, because this Mac has no Nix. The tools above came from Homebrew, the
  user's bin directory and a local `uv` environment. That `pkgs.nbb` exists at the pinned nixpkgs is
  also unchecked.
- No screen, service, signer, ledger or real order uses this core yet.
- This is the core only. It proves nothing about receipts from real work, which is stage V1.
- CI does not run these checks. Using JVM-free tools in this repository's CI is a separate decision.
