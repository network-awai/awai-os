# Cell 3 design — rewrite-sequence proof object with an independent checker

Status: **DESIGN ONLY.** Nothing here is implemented or measured. Cells 1 and 2
are evaluation of a model; neither carries a proof object, so neither is PCC. This
document specifies the smallest artifact that could be, and what would make it fail.

## Why cell 2 is not PCC (the reason this design exists)

Cell 2's nine theorems are ground equalities with no variables, and ACL2 accepted
each by running the model — its own output shows `Rules: ((:EXECUTABLE-COUNTERPART DG) ...)`.
The file that was called a "corrupted certificate" changed the *claim* (`20` → `21`
in the theorem's input), so what was refused was a false statement, not a damaged
proof. There is no proof object there to damage. This design fixes exactly that.

## Artifact

One JSON object. The claim is two s-expression strings; the proof is a sequence of
steps. Nothing else travels.

```json
{
  "schema": "kotoba.surface-rewrite-proof.v1",
  "claim": {"sugar": "(defn run [n :i64] :i64 (cond (< n 0) 0 :else n))",
            "pure":  "(defn run [n :i64] :i64 (if (< n 0) 0 n))"},
  "rules": "guest-grammar@bab283448:cond",
  "steps": [{"rule": "cond", "path": [], "arg": {"clauses": 2}}]
}
```

- `path` — a list of child indices from the root: `[]` is the whole term, `[4]` is
  the body of a `defn`, `[4,1]` is the test of that body's first `if`.
- `steps` — one entry per rewrite. Each entry names the rule and where it applies;
  it never contains the resulting term, because the checker reconstructs that.
- The claim is fixed before the proof is produced and is not derivable from the
  steps — a step sequence that lands anywhere else is rejected.

## Rules (5, with provenance)

| Rule | Effect | Source |
| --- | --- | --- |
| `->` | value inserted after each call head | `resources/kotoba/lang/guest-grammar.edn:452` |
| `->>` | value inserted as each call's final argument | `guest-grammar.edn:454` |
| `if-not` | `if` with arms swapped | `guest-grammar.edn:476` |
| `cond` | left-to-right nested `if`; final `:else` is syntax | `guest-grammar.edn:551` |
| `case` | single-evaluation nested `let`/`if` equality tests | `guest-grammar.edn:558` |

Pinned at `kotoba-lang/kotoba` `bab283448`, file `resources/kotoba/lang/guest-grammar.edn`.

**Provenance limit, stated up front:** these five entries are *prose* in
guest-grammar ("nested calls with the value inserted after each call head"). The
executable rule table below is Researcher's reading of that prose, not a copy of
Amu's implementation. Nothing in cell 3 can establish that Amu desugars this way;
`SEC-PCC-SURFACE` and any Amu-identity claim stay UNVERIFIED.

## Checker

- **Language:** ACL2 8.7 (`saved_acl2` `a88cf235…`), the same pinned checker.
- **Size budget:** ≤ 300 lines, and it must not call the cell 1/2 model `dg` —
  that is the point. Three functions:
  1. `match-rule` — matches a rule's left pattern at a path, returning a
     substitution or `:fail`. Meta-variables: `$x` (threaded value), `$f` (a call),
     `$t`/`$e` (test/expression), `$k`/`$r` (case key/result).
  2. `apply-step` — applies the named rule at the path with the substitution,
     producing the next term; `:fail` if the pattern does not match there.
  3. `check` — folds `apply-step` over `steps`, then compares the result with the
     claim's `pure`. Accepts iff equal.
- **Trust base:** the ACL2 kernel, the ~300-line checker, the 5-entry rule table,
  the two claim strings. The desugar model is outside it — the checker cannot call
  it and does not know what it would have produced.

## Negative controls (claim stays true; only the proof is damaged)

Each must be rejected by the same checker that accepts the honest proof:

| # | Damage | Expected refusal |
| --- | --- | --- |
| (i) | one rule name changed to another rule that exists | pattern does not match at that path |
| (ii) | one path shifted by one index | pattern does not match, or endpoint differs |
| (iii) | one step deleted | endpoint differs from `pure` |
| (iv) | steps copied from a different pair | endpoint differs, or first step does not match |

A checker that accepts any of these is broken, and the cell fails regardless of
how many positives it accepts.

## The theorem with variables

Ground checks alone prove nothing about the rules. Cell 3 must carry at least one
statement quantified over inputs:

```lisp
(defthm check-sound
  (implies (check claim steps)
           (equal (apply-proof (car claim) steps) (cadr claim))))
```

`apply-proof` is `check` without the final comparison, so the theorem says: an
accepted sequence really does reconstruct the endpoint by applying the named rules
in order at the named positions — i.e. the endpoint lies in the transitive closure
of the rule set applied to `sugar`. Because `check` is written as a fold over the
same `apply-step`, this should follow by induction over `steps` plus a lemma that
`apply-step` returns `:fail` or the term the rule produces.

**If ACL2 does not prove it within a modest lemma budget, cell 3 is reported as
failed** — not softened to "evaluated". A PCC cell without a quantified soundness
statement is cell 2 again.

## What cell 3 would and would not show

**Would show.** Given the five pinned rules, a third party can check a
sugar→pure claim without running the desugar implementation, and any damage to the
sequence (wrong rule, wrong position, missing step, borrowed sequence) is refused
while a false claim is also refused.

**Would not show.** That Amu's desugar equals these five rules; that the two
endpoints mint the same Definition CID (profile 6 / desugar 2 vs the corpus's
profile 4 / desugar 1 — the gap recorded in `SURFACE-CID-GAP`); that ACL2 is
correct; or that the rule table is complete for the language.

## Acceptance criteria for the implementation

1. Checker ≤ 300 lines, no reference to `dg`, sha256 recorded.
2. 5 rules from the pinned guest-grammar lines; threading included (local rewrites
   at a path, so the accumulator objection from cell 1 no longer applies).
3. Positives: ≥ 7 of 8 corpus pairs accepted, with the spelling-inconsistent pair
   named if it fails.
4. Negative controls: all four kinds rejected.
5. `check-sound` proved with variables, or the cell reported as failed.
6. Draft, MEASURED-ONCE; admit stays with the owner.

## Risks

- The rule table may be too weak to express a pair (e.g. `case` with several
  clauses), forcing more rules and a larger checker; the ≤ 300-line budget is the
  tripwire for that.
- Induction over `steps` may need lemmas about the substitution, which can grow
  past the budget; then the honest outcome is a failed cell.
- Amu identity remains unestablished no matter how clean the checker is; this
  design cannot close `SURFACE-CID-GAP`.
