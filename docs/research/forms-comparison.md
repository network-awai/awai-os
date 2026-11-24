# 14 forms — knowledge, meaning, computation, proof (research survey)

Status: user survey 2026-11-24, recorded verbatim as a research draft (UNVERIFIED, not measured). Sourced from the owner-provided comparative text; this file is a curated structural summary, not a measurement. It grounds draft claims ONT-SPLIT-1, SEC-PCC-SURFACE (earlier plan), and the compute-mode proposal (content-addressed proof-carrying ontological FP family).

## 14 forms on a common bank/transfer example

| # | Technology | Core math structure |
| --- | --- | --- |
| 1 | RDF | Directed labelled graph; triple set G = {(s_i,p_i,o_i)}; cyclic possible; no general computation |
| 2 | OWL | Description logic (SROIQ); C ⊆ D, C ⊓ D, C ⊔ D, ¬C; meaning/axioms over RDF relations |
| 3 | Ontology | Conceptual system O = (C,R,I,A) — concepts, relations, instances, axioms; multiple implementations |
| 4 | Datalog | Horn clauses + least fixed point I_{n+1} = I_n ∪ T_P(I_n); convergent (finite, function-free) |
| 5 | Prolog | Goal-driven backward search, unification sθ = tθ, SLD derivation; non-termination possible |
| 6 | Lisp | Lambda calculus M ::= x \| λx.M \| M N; β-reduction; code-as-data via lists |
| 7 | Haskell | Typed lambda calculus (HM polymorphism); f : A → B; g∘f : A → C |
| 8 | ACL2 | First-order logic + induction, executable recursive functions, well-founded measures |
| 9 | Lean | Dependent type theory; context typing Γ ⊢ t : A; propositions-as-types (Curry-Howard) |
| 10 | Rocq/Coq | Calculus of Inductive Constructions; inductive types and proofs in one framework |
| 11 | F* | Refinement types {x:A | P(x)}, Hoare-style triples {P} C {Q}, effects + SMT |
| 12 | TLA+ | State-transition system M=(S,S0,R); Spec = Init ∧ □[Next]_v; Box/Diamond/implies temporal operators |
| 13 | S-expr | Recursive data S = Atom + S × S; List(A) = 1 + A × List(A); meaning attached by semantics |
| 14 | IPLD | Content-addressed Merkle DAG; h(v) = H(Encode(data_v,links_v)); CID = hash + codec + version |

Full worked example (owns / balance / transfer) and per-technology tables are in the source survey archived with this draft (user message 2026-11-24).

## Structural difference

Graph shape (tree / DAG / cyclic / order-sensitivity) differs across the 14; more importantly, the same Merkle DAG can store graph/S-expr/logical/proof data, but storage unification does not unify meaning: semantically identical formulas do not necessarily share a CID, and cyclic OWL relations stored as DAG need indirect stable IDs.

## Kotoba layering (proposal)

| Layer | Adopted math | Reference tech |
| --- | --- | --- |
| L0 physical store | bytes + hash | IPLD |
| L1 data structure | Merkle DAG | IPLD, CAS |
| L2 syntax | recursive algebraic type | S-expr |
| L3 computation | lambda calculus | Lisp, Haskell |
| L4 types | dependent type theory | Lean, Rocq |
| L5 knowledge | description logic | RDF, OWL |
| L6 inference | least fixed point / unification | Datalog, Prolog |
| L7 formal proof | type theory / induction | Lean, ACL2 |
| L8 effects/permissions | refinement types / effects | F* |
| L9 distributed system | state transition / temporal logic | TLA+ |
| L10 machine execution | operational semantics | Amu Compiler |

Common model K = (G, Γ, F, R, A, P, E): content-addressed data graph, type/variable environment, computable functions, inference rules, ontology/axioms, proofs, effects/permissions. Executable predicate: Executable(f,x) = TypeCheck(f,x) ∧ Authorized(f,x) ∧ VerifyProof(f) ∧ WithinBudget(f,x), with termination + resource bounds — a dispatch model for safe dispersed computation.

## Compute modes (proposal)

Knowledge / Total / Proof / General / Effect, over S-expr + type theory + IPLD/CID with Amu Compiler/Reasoner/Proof Kernel. Knowledge mode = decidable OWL/Datalog inference; Total mode = termination-proven subsets for asset/permission/state transitions; Proof mode = propositions/theorems/invariants/proof terms; General = unrestricted recursion/side effects; Effect = network/storage/I-O/permissions.

## Must-split (open-world vs closed-world)

| Item | Knowledge inference (OWL) | Execution admission (security) |
| --- | --- | --- |
| World assumption | Open: missing is unknown, monotonic derivation | Closed: unconfirmed right = refuse; cancellable, stateful |
| Contradiction | Inconsistency | Must trigger execution refusal |

A shared S-expr layer therefore needs two distinct admission semantics — a knowledge-base acceptance rule and a runtime permission checker, never conflated (draft claim ONT-SPLIT-1).

## References

Lean 4 (lean-lang.org), ACL2 (acl2.org), F* (fstar-lang.org), Rocq (rocq-prover.org), Agda (agda.readthedocs.io), W3C RDF/OWL, Stanford Encyclopedia (ontology). Specific quantitative benchmark claims in the source survey are explicitly marked as design reference scores, not measured benchmarks, and are not quoted here as evidence.
