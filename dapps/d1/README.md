# D1 core (.cljc Otehon)

The decidable core of the D1 first vertical
([ADR 0027](../network-awai-apex/docs/adr/0027-first-bot-economy-slice-on-otehon.md)),
as a shared `.cljc` oracle in the saifu pattern: one pure core, one shared
case file, two runners. It holds no keys, performs no I/O, and moves no
funds. It is **not built into the OS image**.

| Part | File | Runs on |
| --- | --- | --- |
| Pure core | `src/d1/core.cljc` | Basilisp and Babashka, unchanged |
| Shared cases | `test/cases.json` | Both (83 cases) |
| Basilisp runner | `test/run_cases.lpy` | Basilisp: `basilisp run` |
| Babashka runner | `test/run_cases.clj` | Babashka: `bb --classpath` |

## What the core decides

- D1 stage transitions (`transition`) and stable-request redelivery
  (`redeliver`, replay-only, never re-executes).
- Receipt shape (`receipt-problem`): required and forbidden keys of
  `awai.work-receipt/1`; engine/model/measured sub-keys. Prompt, output
  body and credentials are refused, never stored.
- Tsukasa declaration check (`first-problem`, `has-runtime-class?`) with
  the exact `tsukasa/*` reason literals and precedence
  id, did, failure-domain, availability, runtime-classes.
  Otehon reads the accepted 2-class rule (ADR 0010 S2.1:
  `wasm`/`container`): masks carrying the microvm bit are
  `tsukasa/unknown-runtime-class` here. The divergence with the tsukasa
  3-class mask stays an owner decision (AWAI-233 blocker).
- Itonami annotation/digest checks: only the two reason names the ADR
  text fixes (`itonami/runtime-class-mismatch`,
  `itonami/unsupported-digest`). Grant and digest/CID/signature
  mismatches have no individual names yet (JUN-288) and stay generic.
- Fune admission bounds (`bound-problem`) and the shared-node aggregate
  formula (`admission-eval`, including stale-observation wait,
  invalid-amount refusal, and dry-run-never-permits).
- `contribution-dispatch-plan` combines authenticated provider/requester
  consent facts with scoped reservation facts and `admission-eval`. It returns
  a launch **plan**, not a permit or an execution. The caller must verify the
  signatures and revocations, atomically persist and fence a reservation,
  supply a trustworthy fresh capacity snapshot, enforce time and limits at
  launch, and prevent replay. A caller-controlled `authenticated?` or
  `verified?` boolean is not proof. `committed` must describe capacity before
  this reservation; this function does not make concurrent decisions atomic.
- `contribution-witness-evaluation` compares the expected public-fixture
  output against the independently observed output and receipt binding. Its
  `receipt-verified?` fact must come from the host's signature verifier and
  the host must calculate the output digest. It does not verify either itself.

These additions are not connected to the host executor, image, network or
durable reservation store. They do not provide authenticated consent, a
cross-node protocol, an OCI bot run, or an independent signed witness receipt.

`src/d1/dispatch.cljc` defines a host orchestration boundary: scoped consent
verification precedes a durable atomic reservation, followed by a second
consent/lease/fence check before calling the host launcher. The host owns the
adapters and must enforce the fence at the actual effect boundary; these
checks alone cannot close a concurrent-revocation or split-brain race. The
orchestrator does not register a host adapter, authenticate signatures, make a
reservation, start containers, release an uncertain reservation, or guarantee
an exception's effect has been rolled back. Adapter exceptions produce
`:unknown` and require reconciliation, including when a launcher might already
have started a process. Its 25-assertion test uses only synthetic adapter
results; bypassing revalidation produces eight failures.

## Check

```bash
cd dapps/d1
PYTHONPATH=src basilisp run test/run_cases.lpy
bb --classpath src:test test/run_cases.clj
bb --classpath src:test test/dispatch_test.clj
```

A changed expectation fails on both (exit 1); the run above is the
negative control.

## Evidence (2026-11-08, Apple M1 Max)

| Check | Result |
| --- | --- |
| Shared cases on Basilisp 0.5.1 | 58 of 58 |
| Shared cases on Babashka v1.12.218 | 58 of 58 |
| Broken expectation on Basilisp | 1 failure, exit 1 |
| Broken expectation on Babashka | 1 failure, exit 1 |
| `test/cases.json` sha256 | `65ecce39e634f171b70297bde5bfce286f579b2758bdbb434d45a81c940c7536` |
| `src/d1/core.cljc` sha256 | `71e44c74153dac8825a422a0f1b80a0f319c0d73a96fe1ca3109d04992d42d03` |

The table describes the earlier 58-case baseline. For the AWAI-235 extension,
all 83 cases pass locally on both runners and separately on levi and benjamin
under macOS Babashka. The latter are component tests on two physical hosts,
not Otehon VM boots or a two-node job. A local mutant removing the consent
authentication-fact check fails both provider and requester cases. Babashka is
an approved Otehon tool (ADR 0026 D3); Java was not used for these checks.

## Not verified or not implemented

- The NixOS VM evidence run (harness exists in `nixos/`, unexecuted).
- Real node pull/start/receipt (JUN-288/292/296): grant class policy,
  L5 items, digest/CID binding, framed stdio, writer fencing.
- `orders.hy` (ADR 0027 says added; absent from the repo).
- Hermes per-order keys, multi-turn-to-one-order (V2 undesigned).
- Fund movement, live cutover, custody, production wiring.
