# Cell 3 — results (draft, MEASURED-ONCE, 2026-11-24)

**Verdict: cell 3 remains FAILED.** The checker no longer accepts the four false
claims the reviewer found, and four of the five rules now have a variable-quantified
correctness proof. What is still missing is the checker's own soundness theorem, so
acceptance is not yet proved to mean anything. Nothing here is admitted.

## 1. The four counterexamples were real — measured, then fixed

Run against the previous checker (`checker-buggy.lisp`, kept as evidence;
`evidence-counterexamples-buggy.out`). All four were **accepted**:

```
RESULT neg-x-else-as-metavar   expected=NIL got=T   (cond (< n 0) 1 (< n 5) 7) → (if (< n 0) 1 7)
RESULT neg-xi-case-key-capture expected=NIL got=T   (case n t 10 20) → (let (t n) (if (= t t) 10 20))
RESULT neg-xii-else-not-final  expected=NIL got=T   (cond :else 1 (< n 5) 2) via cond-step
RESULT neg-xiii-fail-as-term   expected=NIL got=T   claim ((cond a) :fail)
```

Causes, in the same order: `match-pat` treated **every keyword** as a metavariable,
so `:else` in the `cond-2` pattern matched anything; `rule-match` read the capture
flag from `caddr` (the right-hand side, always true) instead of `cadddr`, and checked
only `:r`/`:d`, so the **key** `:k` escaped; `cond-step` had no `:else`-position
condition; and `:fail` was returned as an ordinary value, so a claim whose `pure` was
`:fail` matched a failing run.

Fixes: metavariables are the `?`-symbols in `*metavars*` (`:else` is a literal
again); the flag lives in the right slot and the key is capture-checked; both cond
rules carry a "the test may not be `:else`" guard and `cond-step` also requires
another clause to follow; refusal is a **multiple value** `(mv ok term)` that cannot
be confused with a term.

## 2. Checker — measured on the fixed version (`evidence-tests-fixed.out`)

0 ACL2 errors. 3 positives accepted, **12 negative controls refused**:

```
pos:cond1 T   pos:chain T   pos:ifnot T
neg-i  wrong-rule          NIL    neg-vii   unknown-rule      NIL
neg-ii shifted-path        NIL    neg-viii  out-of-range      NIL
neg-iii missing-step       NIL    neg-x     :else as metavar  NIL
neg-iv borrowed-sequence   NIL    neg-xii   :else not final   NIL
neg-v  false-claim         NIL    neg-xiii  :fail as a term   NIL
neg-vi extra-step          NIL    neg-xiv   cond-2 :else test NIL
```

## 3. Rule correctness, independent of the rule table (`evidence-rules.out`)

`rules-correct.lisp` (102 lines) is a separate evaluator (`evl`, over `if`, `if-not`,
`not`, `=`, `<`, `+`, `let`, `cond`, `case`) that uses neither `match-pat` nor the
checker. One theorem per rule, quantified over every environment and every subterm:

| Rule | Theorem | Result |
| --- | --- | --- |
| `if-not` | `rule-if-not` | **Q.E.D.** |
| `if-not-swap` | `rule-if-not-swap` | **Q.E.D.** |
| `cond-2` | `rule-cond-2` (hypothesis: test ≠ `:else`) | **Q.E.D.** |
| `cond-step` | `rule-cond-step` (rest non-empty; first rest test ≠ `:else`; test ≠ `:else`) | **Q.E.D.** |
| `case-1` | `rule-case-1` | **failed** |
| helper | `evl-ignore-unbound` (if `t` is not free, binding it does not change the value) | **Q.E.D.** |

`case-1` was therefore **removed from the rule table**: an unproved rule does not
belong in a checker. Its positive and capture tests were dropped with it, which is why
this run has 3 positives rather than 4. Note the hypotheses are not decoration: the
`cond` theorems are false without "the test is not `:else`", which is exactly one of
the four defects above — the independent evaluator found it again from the other side.

Two failure modes on the way were in my own evaluator rather than the rules: the
`:else` arm tested `(endp (cdr clauses))` where it needed `(endp (cddr clauses))`, so
every `cond` ending in `:else` evaluated to `:stuck`; and ACL2's built-in `EV` had to
be avoided, so the evaluator is `evl`.

## 4. Why the first nine controls missed all four defects

Every one of the first nine damaged the **proof** (wrong rule name, shifted path,
missing or extra step, borrowed sequence) or the **claim** (false `pure`). None of them
required the rule table to be *right* — only that the checker be consistent with
itself. Because `step-rel` and `apply-step` share `match-pat` and the same table, a
wrong rule is applied identically on both sides, so the soundness theorem, had it been
proved, would have been equally blind. That is why rule correctness came before more
proof engineering, and why "enumerate on the same recursion" (my earlier proposal) was
dropped: it removes the last place where the two sides could disagree.

## 5. What is still missing

- **No checker soundness theorem.** `check-sound` is not proved; acceptance by this
  checker is not known to place the endpoints in the rules' transitive closure. Cell 3
  stays **FAILED**.
- No Amu identity, no Definition CID equality — `SEC-PCC-SURFACE` stays UNVERIFIED.
- 3 of the 8 corpus pairs are expressible with the four proved rules; threading and
  `case` are not covered.

## Reproduce

```bash
cd ~/pcc/src/acl2-8.7
cat ~/pcc/cells/checker-buggy.lisp ~/pcc/cells/tests-counterexamples.lisp | ./saved_acl2 | grep RESULT
cat ~/pcc/cells/checker.lisp ~/pcc/cells/tests.lisp | ./saved_acl2 | grep RESULT
./saved_acl2 < ~/pcc/cells/rules-correct.lisp | grep -c 'Q.E.D.'      # 5
```

`proofs.lisp` (the earlier soundness attempt: `apply-step-is-step-rel`, `check-sound`)
is kept as the record of what did not go through; it is not loaded by any run above.
