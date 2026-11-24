# Cell 3 design — rewrite-sequence proof object with an independent checker

Status: **DESIGN + implementation (draft, MEASURED-ONCE)**. This revision answers
the five review points; results of the implementation are in `RESULTS.md`.

## Why cell 2 is not PCC

Cell 2's nine theorems are ground equalities with no variables and ACL2 accepted
each by running the model (`Rules: ((:EXECUTABLE-COUNTERPART DG) ...)`). Its
"corrupted certificate" changed the *claim*, not a proof. There is no proof object
there to damage. This cell exists to fix exactly that.

## Artifact (revision: no JSON, no parser)

The proof object is a single ASCII file that ACL2 reads directly. **Nothing
outside ACL2 parses it**, so no parser sits in the trust base (review point 4).

```lisp
;; kotoba.surface-rewrite-proof.v1
((claim (defn run (n :i64) :i64 (cond (< n 0) 0 :else n))
        (defn run (n :i64) :i64 (if (< n 0) 0 n)))
 (steps ((cond-2 (1)))))
```

- `claim` — the two endpoints, fixed before the proof is produced.
- `steps` — `(rule path)` pairs. **The intermediate terms are not carried**; the
  checker reconstructs each one, so a step cannot "assert" a result (review point 5
  — `arg` is gone).
- `path` — child indices from the root; `(1)` is element 1 of the term.

## Rules (4, as data with patterns)

**Revision after review:** metavariables are the `?`-symbols of `*metavars*`, so
`:else` is a literal again; refusal is a multiple value `(mv ok term)`, never a
term; `case-1` is **not** in the table because its correctness theorem is unproved
(see `RESULTS.md` §3).

| Rule | Left pattern | Right template | Extra condition | Source |
| --- | --- | --- | --- | --- |
| `if-not` | `(if-not :c :a :b)` | `(if (not :c) :a :b)` | — | `guest-grammar.edn:476` ("if + not") |
| `if-not-swap` | `(if (not :c) :a :b)` | `(if :c :b :a)` | — | **corpus** `:if-not-vs-swapped-if` pure form |
| `cond-2` | `(cond ?t1 ?e1 :else ?e2)` | `(if ?t1 ?e1 ?e2)` | `:else` final **and** the test is not `:else` | `guest-grammar.edn:551` |
| `cond-step` | `(cond ?t1 ?e1 . ?rest)` | `(if ?t1 ?e1 (cond . ?rest))` | another clause follows; neither test is `:else` | `guest-grammar.edn:551` |
| ~~`case-1`~~ | dropped | — | correctness theorem unproved | `guest-grammar.edn:558` |

Review point 2: `if-not` is split into two rules — the grammar's "if + not" and the
arm swap that comes from the corpus, cited to the corpus rather than the grammar.
Review point 3: `case-1` carries the capture condition, and a pair whose branch
mentions `t` is a negative control; `cond`'s `:else`-final requirement is likewise a
condition on the rule.

**Provenance limit.** These entries are prose in `guest-grammar.edn`
("nested calls with the value inserted after each call head"). The executable table
is Researcher's reading of that prose. Nothing here shows Amu desugars this way;
`SEC-PCC-SURFACE` stays UNVERIFIED.

## Checker

- ACL2 8.7 (`saved_acl2` `a88cf235…`), ≤ 300 lines, **must not call `dg`**.
- `root-step` — the one-step relation, **declarative**: `∃` a rule whose left
  pattern matches and whose right template instantiates to the result. It does not
  use `apply-step`.
- `step-rel` — one-step anywhere in the term, by the standard one-hole
  decomposition (`car` recurred into, or `cdr` recurred into, or the root), again
  without `apply-step`.
- `apply-step` / `check` — procedural: locate the path, verify the redex, rebuild,
  fold over the steps, compare with `pure`.
- Trust base: ACL2 kernel, the checker source, the 4-rule table, the claim file.
  No parser and no desugar model.

## Rule correctness comes before checker soundness

A checker soundness theorem cannot catch a wrong rule: `step-rel` and `apply-step`
share the rule table, so a bad rule is applied identically on both sides. Each rule
must therefore be justified **independently of the table and of `match-pat`**, by a
theorem over a small separate evaluator: for every environment and every subterm,
the two sides evaluate to the same value. A rule whose theorem is not proved is
removed from the table. Results: `RESULTS.md` §3.

## The theorem with variables (review point 1)

```lisp
(defthm check-sound
  (implies (check claim steps)
           (rtc (car claim) (cadr claim) (terms-of steps))))
```

`rtc` is the reflexive-transitive closure of `step-rel`, kept as a witness list so
the statement is first-order. It is **not** defined through `check`: the chain is
`apply-step` → `step-rel` (a lemma) → `rtc` (a definition). If `apply-step` were
used to define `step-rel`, this would be circular and does not count.

## Negative controls

Claim left true unless stated; (v) is the only one that changes the claim.

| # | Damage | Expected |
| --- | --- | --- |
| (i) | one rule name replaced by another existing rule | refused |
| (ii) | one path shifted by one | refused |
| (iii) | one step deleted | refused |
| (iv) | another pair's sequence | refused |
| (v) | correct sequence, false claim | refused |
| (vi) | one extra step appended | refused |
| (vii) | unknown rule name | refused |
| (viii) | path out of range | refused |
| (ix) | `case` pair whose branch mentions `t` | refused (capture condition) |

## Failure rule

If `check-sound` does not go through within a modest lemma budget, the cell is
reported **failed**, not softened. `RESULTS.md` records whichever happened.
