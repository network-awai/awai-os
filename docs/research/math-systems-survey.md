# 15 math systems survey — Kotoba/Amu/Awai alternatives to dependent-type lambda calculus (research material)

Status: user survey 2026-11-24, recorded verbatim as a research draft (UNVERIFIED, not measured). Reference scores in the source are explicitly hypothetical, not benchmarks, and are not quoted here as evidence. This note grounds the same draft claims as the 14-form survey (ONT-SPLIT-1, SEC-PCC-SURFACE).

## 15 candidates (◎ core / ○ formalisable / △ needs added logic)

Computational logic (ACL2-type), higher-order logic, constructive set theory, category theory/categorical logic, topos theory, combinatory logic, term rewriting systems (TRS), rewriting logic, equational logic/multi-sorted algebra, linear logic, interaction nets, matching logic, Horn clause logic, graph rewriting systems, realizability theory. Dependent-type lambda calculus remains the baseline; the 15 are not mutually independent (TRS-rewriting, linear-interaction, category-topos overlap).

## Fitness simulator snapshot (2026-11-24, user-provided)

Weights (0..5): Knowledge 2, Compute 2, Proof 1, Safety 5, Termination 3, DAG-fit 2, Parallel 2, Implementation maturity 1.

Ranking by weighted score: 1. Dependent lambda (91.7), 2. Rewriting logic (88.9), 3. Linear logic (88.3), 4. Computational logic (87.8).

## Core formulas (reference)

Computational logic f(x)=t(x) (ACL2); HOL ∀P:A→Bool (Isabelle/HOL); CZF/IZF; g∘f:A→C; χ_A:X→Ω; Sxyz=xz(yz) (SKI); lσ→rσ (Stratego, AProVE); [t]→[t'] (Maude); t1=t2 (OBJ, CafeOBJ); A⊸B (LLF); α⋈β→N (HVM); M⊨φ (K Framework); H←B1∧B2 (Prolog/Datalog); L←K→R (GROOVE/GP 2); e⊩P (Kleene).

## Kotoba priority-5 (excluding dependent types)

1. Rewriting logic — unified knowledge/function/state/inference; candidate core.
2. Matching logic — unified semantics for multiple logics; Amu spec + verifier generation from one semantics (K Framework).
3. Graph rewriting — IPLD/distributed integration via graph transformations.
4. Linear logic — ownership/capability/asset/resource control (finance/OS/security).
5. Interaction nets — local parallel computation; comms cost may erase gain.

## Rewriting-logic recommendation (proposal)

Core R = (Σ,E,R); with proofs + constraints K = (Σ,E,R,P,C). Verifiable properties: termination (well-founded measure drop), determinism, confluence (A→*B, A→*C ⇒ ∃D), safety (invariant preservation), resource bounds, commutation of independent rewrites. Confluence + termination ⇒ unique normal form; normal-form encoding + CID gives path-independent CIDs from different computation orders (does NOT by itself give blockchain consensus).

## Layering proposal (Awai Network)

L0 bytes/hash (IPLD); L1 Merkle DAG; L2 S-expr syntax; L3 lambda computation; L4 dependent types (Lean/Rocq — baseline); L5 description logic (RDF/OWL); L6 least fixed point/unification (Datalog/Prolog); L7 formal proof (Lean/ACL2); L8 effects/permissions (F*/refinement); L9 distributed temporal logic (TLA+); L10 machine execution (Amu Compiler).

Candidate by priority: higher proof power = dependent type/HOL; unified knowledge/computation/state = rewriting logic; unified semantics = matching logic; DAG/CID integration = graph rewriting; fast parallel = interaction nets; finance/permissions = linear logic; minimal kernel = combinatory logic; S-expr/execution/proof = computational logic.

Ask: read as research material only; minting ONT-SPLIT-1, SEC-PCC-SURFACE, FUEL-BOUND, or rewriting-logic core claims (e.g. REWRITE-CORE) awaits organizer approval on the draft.
