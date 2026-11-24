# Practical evaluation model + mainstream-language comparison plan (research draft)

Status: user proposal 2026-11-24, recorded as research draft (UNVERIFIED, not measured). Extends research/docs/forms-comparison.md + math-systems-survey.md. Two parts: (1) mapping the 8 simulator axes to practical compiler/OS/hardware/distributed-network performance; (2) a comparison framework for JS/TS/Rust/C/C++/Python/Java under the same axes, to be executed next (this note is the plan only).

## Part 1 — 8 axes mapped to practical performance

Each simulator axis (Knowledge, Compute, Proof, Safety, Termination, DAG-fit, Parallel, Maturity) maps to language-level meaning and to specific measurable resources (RAM/SSD/HDD, CPU/GPU/cache, dev time, funding, network, power). Tables of concrete measurables per axis: bytes/entity, queries/sec, facts/sec, ns/op, FLOPS, cache hit %, ms/functions/sec, fat, hours, CC, GB/1M facts, tokens/knowledge, proofs/sec, LOC, buffer overflow counts, instruction upper bounds, WCET, dedup %, cache hit %, CID ns/node, IPC, Speedup, TPS, throughput, USD/year. All values in the source survey are reference-design values, not measured benchmarks.

Notable proposals: split 8 axes into 25 practical items (compute/data/knowledge/verification/safety/distributed/development); new practical weights (Network 5, Security 5, Termination/resource 5, DAG 5, Parallel/distributed 5, Determinism 5; CPU 4, GPU 3, RAM/cache 4, Storage 4, Knowledge/inference 4, AI/LLM 4, Formal proof 3, Dev productivity 3); objective = minimum total cost under safety/time/memory/network constraints, i.e. maximise useful computation with safety satisfied ÷ total economic cost (CPU+GPU+RAM+Storage+Network+LLM+Verification+Development).

## Part 2 — 7 mainstream languages under the same axes (PLAN, not measured)

Rank JS, TS, Rust, C, C++, Python, Java on the 8 axes (or the 25-item breakdown) with per-axis metric + unit + expected evidence source (compiler backend e2e timings, binary size, sanitizer findings, cache profiles, dev-time sampled). Execution order: 1) Rust/C/C++ (unsafe/runtime tradeoffs), 2) JS/TS, 3) Java/Python. Cells: each language gets one row per axis stating the measurable target and the status (measured / pending / unverified). Excluded: full benchmark suite port — the plan ranks on the axis framework first, then spends measurement budget where differences are largest.

Ask: mint MAINSTREAM-7 as an UNVERIFIED draft claim in program-map; ACL2-oracle remains the reference for dependency/compilability claims where used.
