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
| helper | `evl-ignore-unbound` (if `t` is not free, binding it does not change the value) | **FAILED** (corrected — an earlier version of this file said Q.E.D.; see note) |

The five `Q.E.D.` lines in the run are the four rule theorems above plus the model's
own admission of the mutual recursion — **not** the helper, which failed. Which form
each `Q.E.D.` belongs to can be read from `evidence-rules.out` in order; an earlier
version of this file misread that sequence and credited `evl-ignore-unbound`.

Because the helper failed, the `case-1` proof never had its main ingredient, and
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

## 5. Four more counterexamples: correct rules, wrong context

The rules being individually correct does not make them correct *where they are
applied*. Run against the current (fixed) checker, all four are **accepted**
(`evidence-context.out`):

```
RESULT neg-xv-args-position        expected=NIL got=T  (defn f (if-not a b c) :i64 1) → (defn f (if (not a) b c) :i64 1)   path (2)
RESULT neg-xvi-let-binding-position expected=NIL got=T (let (if-not x y z) 1) → (let (if (not x) y z) 1)                    path (1)
RESULT neg-xvii-cond-arity         expected=NIL got=T  (cond a 1 b) → (if a 1 (cond b))
RESULT neg-xviii-not-shadowed      expected=NIL got=T  (defn f (not :i64) :i64 (if-not a b c)) → (if (not a) b c)
```

Why each slips through:

- **(xv)/(xvi)** the checker has no notion of *which* positions hold expressions. A
  parameter list and a `let` binding vector are not expression positions, but a path
  into them is a path like any other, so the rule fires there.
- **(xvii)** no rule requires a `cond` to keep its clause count consistent: a trailing
  test with no branch is accepted, and `(cond b)` is not a term of the language.
- **(xviii)** `not` is an operator, but nothing prevents a parameter from being named
  `not`; where that binding is in scope, `(not a)` is a call of a variable, so the rule
  changes the meaning even though its theorem holds for all subterms.

The point for the record: **rule correctness is a statement about subterms, and cannot
see binding structure or position kinds.** No number of rule theorems removes these
four, and the earlier "prove soundness for the proved rules only" plan would not have
either — which is why cell 3 ends here rather than continuing.

### 2026-11-27 addendum: empirical triage on kotoba-lang/amu HEAD 87ec570a (AmuSpec)

`AmuSpec` triaged the four context-level counterexamples above against the live
native compiler (`kotoba-lang/amu` HEAD `87ec570a`); all source citations and
read-only `bin/amu check` / `seed/bootstrap/aarch64-macos/amu-full-root.macho definition-cids`
outputs below were independently reproduced on `87ec570a` on 2026-11-27:

- **`neg-xv-args-position` — defended in `amu`.** `ck-ds-multi`
  (`seed/21-check.kotoba:4749`) requires each signature clause to begin with a
  vector (`ND-VEC`), rejecting `(defn f (if-not a b c) :i64 1)` with `E2119`
  (`malformed signature of 'f'`).
- **`neg-xvi-let-binding-position` — confirmed real compiler bug.**
  `ck-ds-walk` (`seed/21-check.kotoba:1823`) recursively desugars the `let`
  binding slot before `let` syntax checking: `(let (vector-i64 x 1) x)` passes
  `bin/amu check` (`ok`) and produces the exact same Definition CID as
  `(let [x 1] x)` (`bafyreiag4t37eamhtxuufux6a6u3i3e3ifohhjnhevojzd5lvi456vbope`),
  while `(let (if-not true 1) 1)` emits `E2110` (`if needs exactly a test, a then and an else`)
  instead of `E2111` (`malformed binding vector in 'let'`).
- **`neg-xvii-cond-arity` — defended in `amu`.** Both `ck-cond`
  (`seed/21-check.kotoba:2515-2516`) and `dsb-cond`
  (`seed/05-checked-source.kotoba:228-239`) require even clause arity with a
  final `:else`, rejecting `(cond a 1 b)` with `E2109`
  (`cond needs a final :else clause`).
- **`neg-xviii-not-shadowed` — defended in `amu`, with an open spec contradiction.**
  With parentheses, `(defn f (not :i64) :i64 (if-not ...))` fails with `E2119`.
  With brackets (`[not :i64 ...]`), `amu` desugars `(if-not a b c)` via branch
  swap (`(if a c b)`, `ck-ds-ifnot` at `seed/21-check.kotoba:554-562`) with a
  hygienic synthetic head (`nm-gensym`, `seed/20-names.kotoba:1352-1361`),
  preserving the Definition CID regardless of whether a parameter is named `not`.
  However, `seed/tests/checked-definition-authority/guest-grammar.edn:476-477`
  still specifies `:if-not {:desugars-to "if + not"}`, contradicting
  `docs/adr/0191-language-profile-5-bool-typed-predicates.md` and `amu`'s branch
  swap; the two spellings mint distinct Definition CIDs on
  `(defn f [a :bool b :i64 c :i64] :i64 ...)` (`bafyreiaxhpo6y...` for `if-not`
  vs `bafyreihh3lr4k...` for `(if (not a) b c)`). This spec contradiction is
  tracked for owner semantics decision in `AmuSpec` Item #569.

This triage locates which of the four counterexamples also hit the live compiler;
it does not change the cell 3 checker verdict (**FAILED**) or `SEC-PCC-SURFACE`
(**UNVERIFIED**).

## 6. Not started: a checker that knows positions and bindings

The next stage would give the checker (a) a *position predicate* saying which child
indices of each form are expression positions (`defn` body but not its parameter list;
`let` body but not its binding vector; statement positions in a `do`), and (b) a
*binding predicate* per position (which names are shadowed there, so a rule whose
right-hand side introduces or mentions an operator name is refused under a shadowing
binding), plus (c) a congruence theorem per form: if a rewrite is valid at an
expression position and does not capture, then the whole term rewrites to the same
value. Only after that does a soundness theorem mean anything. This is a proposal;
nothing is implemented, and starting it is the owner's call.

## 7. What is still missing

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
