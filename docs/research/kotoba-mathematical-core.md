# Kotoba mathematical core — proposed direction, evaluation model, simulator

Status: PROPOSAL (UNVERIFIED, not measured). Owner direction 2026-11-24 carried into a research plan by Researcher. Nothing here qualifies a compiler, runtime or device. Scores produced by the simulator are ranking aids, not evidence.

## Direction under test

**Content-addressed, proof-carrying, rewriting-based graph computer**: rewriting logic as the core operational semantics, linear/logical resource constraints for assets and capabilities, graph rewriting as the execution model over a Merkle DAG (IPLD/CID), S-expressions as surface syntax, and dependent type theory (Lean/Rocq) kept as the *external* proof basis for the rewriting system, IR and compiler rather than as the runtime engine.

The competing hypothesis is dependent-type lambda calculus as the core (earlier baseline). Both stay live until reference implementations are measured; this document does not settle it.

Rejected framings: one engine for everything. The proposal keeps per-purpose engines over one shared data structure (syntax, storage, identity) — speeds, decidability and proof strength differ too much to merge.

## Layer candidates

| Layer | First choice | Second choice |
| --- | --- | --- |
| Kotoba core semantics | Rewriting logic | Dependent lambda calculus |
| Kotoba knowledge | Horn clause logic | Equational logic |
| Kotoba formal proof | Dependent type theory | Higher-order logic |
| Amu optimisation | Term rewriting | Equational logic |
| Amu semantics check | Matching logic | Dependent type theory |
| Amu IR | Graph rewriting | Term rewriting |
| Amu GPU execution | Data-parallel / interaction nets | Parallel term rewriting |
| Awai permission | Linear logic | Refinement types |
| Awai asset | Linear logic + rewriting | Computational logic |
| Awai distributed execution | Graph rewriting | Rewriting logic |
| Awai state verification | Matching logic | Temporal logic (TLA+) |

Physical storage stays hardware-specific even when the logical structure is unified (registers: fixed-width scalars; L1: contiguous arrays; L2/L3: compact DAG/arena; RAM: hash-consed DAG + index; VRAM: SoA/CSR; NVMe: DAG blocks; HDD: CAR/large packs; network: CID + diff blocks). Making everything a Merkle DAG from the start is explicitly not recommended.

## Optimisation model

Safety is a constraint, not a weight: a high score must not buy past it. Among systems that satisfy the constraints, minimise total cost.

```
minimise  C_total(M)
subject to  MemorySafe(M) ∧ CapabilitySafe(M) ∧ AssetInvariant(M)
          ∧ ResourceBounded(M) ∧ Deterministic(M)
C_total = C_CPU + C_GPU + C_RAM + C_Storage + C_Network
        + C_AI + C_Verification + C_Development
```

Termination, determinism and resource bounds are required for safe compute modes and named state transitions; long-running services and general computation use a separate control regime, never the safety-constrained one.

## Evaluation axes and weights (owner survey 2026-11-24, sum 59)

CPU 4, GPU 3, RAM/cache 4, Storage 4, Network 5, Knowledge/inference 4, AI/LLM 4, Formal proof 3, Security 5, Termination/resource 5, DAG/CID 5, Parallel/distributed 5, Determinism 5, Developer productivity 3.

Score: `Score_j = 100 · Σ(w_i · s_ji) / (10 · Σ w_i)`. Hard constraints enforced before ranking: security, termination, determinism at/above the floor (default 7).

## Simulator (implemented)

| Path | Purpose |
| --- | --- |
| `docs/research/simulator/systems.json` | 16 systems × 14 axes, PROVISIONAL researcher-entered reference scores |
| `docs/research/simulator/rank.py` | deterministic reference implementation (stdlib only): weighted score + hard-constraint filter |
| `docs/research/simulator/index.html` | single-file UI: weight sliders, floor control, ranking bars, score matrix |
| `docs/research/simulator/test_rank.py` | 16 checks (formula bounds, constraint filter, weight overrides, CLI, HTML/JSON parity) |

Reproduce: `python3 docs/research/simulator/rank.py` and `python3 docs/research/simulator/test_rank.py`.

Reference run (default weights, floor 7), computed by `rank.py` on the provisional matrix:

| # | System | Score | Status |
| --- | --- | --- | --- |
| 1 | Rewriting logic | 81.69 | eligible |
| 2 | Graph rewriting | 77.46 | excluded: termination (6 < 7) |
| 3 | Term rewriting (TRS) | 76.44 | eligible |
| 4 | Horn clause logic | 74.07 | excluded: security (6 < 7) |
| 5 | Dependent lambda calculus | 71.69 | eligible |
| 6 | Equational logic | 70.17 | eligible |
| 7 | Computational logic (ACL2 type) | 68.31 | eligible |
| 8 | Linear logic | 68.31 | eligible |

**Provenance limit, stated plainly:** the source survey published weights and 16 final totals but not its per-axis cells. The cells here are Researcher-reconstructed to sit in the published order; the computed totals therefore differ from the survey's totals (e.g. 81.69 vs 87.12 for rewriting logic) and *neither figure is evidence*. Any cell promoted to a measured value must cite the measurement path in this file.

## Benchmark suite (proposed, not run)

20 cells B01–B20 across integer/float/compose, sort/aggregate, matmul, parallel graph reduction, tree build/scan, DAG dedup, CID generate/verify, persist/restore, differential sync, ontology query, recursive inference, LLM codegen/edit, proofs, security/permission cases, termination/resource analysis, asset transfer, distributed parallel (1–128 nodes), heterogeneous re-execution. Proposed single-node rig: 23 vCPU, RTX PRO 6000 Blackwell 96 GB VRAM, 256 GB RAM, NVMe/HDD separated, network 1/10/25 Gbps, RTT 1/10/50/100 ms, loss 0/0.1/1/5%, x86-64 + ARM64, baselines C/Rust/LLVM/GHC. Report median/P95/P99/σ/peak RSS/energy, ≥30 runs per cell, compile and cold/warm paths separated. Every published number must name the harness, rig and revision.

PoC target values (proposal, not commitments): CPU ≥70% of equivalent C, GPU ≥50% of tuned CUDA, RAM ≤80% of non-shared trees, storage ≤80% of non-dedup, diff sync ≤20% of full sync, inference 10^5 facts/s, LLM input tokens −20%, 100% verification of the named rules and 100% blocking of declared-forbidden operations, 100% resource-bound guarantee inside the trust boundary, 100% CID equality on deterministic computations, 6× speedup at 16 cores, 2× faster incremental compile.

## Phases

1. Math-kernel selection — reference implementations of rewriting logic, dependent lambda, TRS, graph rewriting; evaluate B01–B09, B15, B17.
2. Amu compiler — shared IR, native codegen, equational optimisation, verifiable compilation.
3. Knowledge engine — ontology, Datalog-style inference, indexes, LLM-facing representation.
4. Secure runtime — capabilities, linear resources, fuel, proof-certificate checking.
5. Awai distributed runtime — CID diff sync, shared results, state transitions, consensus separate.
6. GPU / large-scale parallel — data parallel, graph reduction, interaction-net comparison.

## Measured so far (4 of 14 axes)

`docs/research/simulator/measure.py` measures determinism, storage, network and
cost on real repository artifacts; results and the numeric comparison against the
targets in this document are in [measured-baseline.md](measured-baseline.md).
Measured weight coverage is 18 of 59 points. Three target-level findings:

- Storage dedup saves 0.51–2.42% on this corpus, not the 20% the target presumes.
- Diff-sync saves 87.5% only with content-defined chunking on a file much larger
  than the block size; on a 5.7 KB document it saves nothing.
- Canonical-form determinism is 240/240; cost is 135 MB/s at 78 MB peak RSS.

The per-system scores in `systems.json` are unchanged by this: they are still
provisional, because no candidate system has a reference implementation here.

## Open, not claimed

- No reference implementation exists for the proposed core; the ranking is over paper structures.
- Confluence + termination give a unique normal form and path-independent CIDs; they do not give consensus, ordering or Byzantine fault tolerance.
- Interaction nets look strong for GPU but network evaluation cost can erase the gain; keep SIMD/SIMT/data-parallel paths regardless.
- `(* x 0) → 0` is unsound where exceptions, non-termination, side effects or floating point exist; rewrites need explicit applicability conditions.
- Prior-art tooling blocked: `bin/kotoba` bootstrap fails on `kotoba-lang/dag-cbor` 404 (recorded on item 178), so PCC/SEC-PCC-SURFACE stays tool-gated.
