# Reward-loop core (.cljc Otehon)

A decidable stock-flow model of the D1 first vertical's reward loop
([ADR 0027](../network-awai-apex/docs/adr/0027-first-bot-economy-slice-on-otehon.md)),
tracked on [AWAI-2812](https://linear.app/kotobalabs/issue/AWAI-2812).
Same saifu pattern as D1/Sanka: one pure core, one shared case file,
two runners. It holds no keys, performs no I/O, moves no funds, and is
**not built into the OS image**.

| Part | File | Runs on |
| --- | --- | --- |
| Pure core | `src/reward_loop/core.cljc` | Basilisp and Babashka, unchanged |
| Shared cases | `test/cases.json` | Both (27 cases) |
| Basilisp runner | `test/run_cases.lpy` | Basilisp: `basilisp run` |
| Babashka runner | `test/run_cases.clj` | Babashka: `bb --classpath` |

## What the core decides

- Loop stocks: `backlog -> leased -> pending -> payable -> paid`, plus
  the terminal sink `dropped` and the funding envelope
  (`funded`/`spent`). Every unit sits in exactly one stock (`totals`).
- `fund` is the only way value enters; `inject` the only way demand
  enters. `assign`/`execute` cap at policy/stock instead of over-drawing.
- `accept` takes explicit ok/bad verdicts: ok moves to payable, bad to
  dropped. All-bad acceptance is legal; dropped units can never be paid
  (case 14 refuses settlement afterwards, case 15).
- `settle` refuses beyond the payable stock and beyond unspent funding;
  settling twice refuses (case 21). Paid never exceeds funded.
- `bottleneck` names the binding steady-state constraint
  (`admit`/`execute`/`verify-ok`/`settle-funds`) with a fixed tie-break,
  so the answer is deterministic.
- Refusals use the exact `reward-loop/*` literals:
  `non-positive-funding`, `non-positive-demand`, `non-positive-count`,
  `bad-count`, `bad-policy`, `over-accept`, `over-settle`,
  `underfunded-settlement`, `bad-rates`.

## System-dynamics reading

Throughput is the minimum of the verified stages, not the sum of
contributions: raising `admit-max` past the verify rate only grows the
pending stock. Funding caps bind independently of verification: a fully
verified loop with `funded < payable` settles nothing more. The floor
(AWAI-207/ADR 0034) gates entry to the loop; this model starts after
admission and does not re-decide it.

## Check

```bash
cd dapps/reward-loop
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src basilisp run test/run_cases.lpy
bb --classpath src:test test/run_cases.clj
```

A changed expectation fails on both (exit 1); the run above is the
negative control. `PYTHONDONTWRITEBYTECODE=1` matches the CI gate, so no
bytecode is written beside the sources.

## Evidence (2026-11-12, Apple M1 Max)

| Check | Result |
| --- | --- |
| Shared cases on Basilisp 0.5.1 | 27 of 27 |
| Shared cases on Babashka v1.12.218 | 27 of 27 |
| Broken expectation on Basilisp | 1 failure, exit 1 |
| Broken expectation on Babashka | 1 failure, exit 1 |

Single-machine run; no comparison with other platforms. Basilisp and
Babashka are approved Otehon tools (ADR 0026 D3); Java was not used for
this check.

## Not verified or not implemented

- The NixOS VM evidence run for this module (harness exists for
  Sanka/D1 in `nixos/`, unexecuted for reward-loop).
- Real node pull/start/receipt (JUN-288/292/296), Hermes keys (V2),
  signer/L1 settlement (V3).
- Lending (`capital`) and AMM/liquidity (`liquidity`): ADR 0027 D9 puts
  them after the first vertical with legal and Torihiki gates. This
  module asserts nothing about them.
- Fund movement, live cutover, custody, production wiring.
