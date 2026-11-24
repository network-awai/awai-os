# Cell 3 — results (draft, MEASURED-ONCE, 2026-11-24)

**Verdict: the checker works; the variable soundness theorem was NOT proved. Per the
failure rule in `DESIGN.md`, cell 3 is reported FAILED.** It is not a PCC cell, and
nothing here is admitted.

## What was built

| File | Lines | sha256 |
| --- | --- | --- |
| `checker.lisp` | 129 | `263a1055…4a761e1` |
| `proofs.lisp` | 42 | `e7ee6f78…7b39034` |
| `tests.lisp` | 22 | `585dac8e…5dbf08` |

`checker.lisp` contains the rules as data (5 entries: `if-not`, `if-not-swap`,
`cond-2`, `cond-step`, `case-1`), `match-pat` / `instantiate` / `rule-match`, the
position functions `fetch` / `embed`, the declarative relation `root-step` /
`step-rel` / `rtc` (defined without `apply-step`), and the procedural `apply-step`
/ `run` / `check`. It never calls the cell 1/2 model `dg`.

## Checker — measured (`evidence-tests.out`)

`cat checker.lisp tests.lisp | ./saved_acl2` → **0 ACL2 errors**, 13 results,
all as designed:

```
RESULT pos:cond1  expected=T got=T      (cond → if at the body, one step)
RESULT pos:chain  expected=T got=T      (3-clause cond, cond-step then cond-2)
RESULT pos:ifnot  expected=T got=T      (if-not then the arm swap, two steps)
RESULT pos:case1  expected=T got=T      (case → let/if, capture condition satisfied)
RESULT neg-i-wrong-rule      expected=NIL got=NIL
RESULT neg-ii-shifted-path   expected=NIL got=NIL
RESULT neg-iii-missing-step  expected=NIL got=NIL
RESULT neg-iv-borrowed-seq   expected=NIL got=NIL
RESULT neg-v-false-claim     expected=NIL got=NIL
RESULT neg-vi-extra-step     expected=NIL got=NIL
RESULT neg-vii-unknown-rule  expected=NIL got=NIL
RESULT neg-viii-out-of-range expected=NIL got=NIL
RESULT neg-ix-capture        expected=NIL got=NIL
```

All nine negative controls are refused while the claim is left true in (i)–(iv) and
(vi)–(ix); (v) changes the claim. So the procedural check discriminates as designed.

## Soundness — measured (`evidence-proofs.out`)

| Lemma | Outcome |
| --- | --- |
| `find-rule-member` | **proved** (Q.E.D.) |
| `root-step-rules-member` | **proved** (Q.E.D.) |
| `root-step-by-rule` | **failed** — the lemma as written is ill-formed: it asserts `rule-match` on `(fetch x p)` while `apply-step` matches the fetched subterm, so ACL2 produced a false obligation |
| `step-rel-update-nth` | **did not finish** — 527 subgoals, no Q.E.D., killed at 600 s |
| `apply-step-is-step-rel`, `check-sound` | **never reached** |

5 Q.E.D. in the run come from the three admitted lemmas plus the model's own
admissions; **`check-sound` has no proof**, so the cell has no quantified soundness
statement — exactly the condition `DESIGN.md` says makes it fail.

## Why it failed, and what would fix it

The declarative `step-rel` decomposes the term by `car`/`cdr` (one-hole
decomposition), while the procedural `apply-step` walks **index-based** paths with
`nth`/`update-nth`. Bridging those two recursions is the blow-up in
`step-rel-update-nth`. The fix is to align them: enumerate rewrites index-wise
(`rewrites-of-nth` mapping `update-nth` over `rewrites` of `(nth i x)`, then
`rewrites-all-nth`), define `step-rel` as membership in that enumeration, and state
`apply-step-is-step-rel` by induction on the path — at which point the induction is
on the same recursion the checker uses.

## What this run still does not show

- No soundness claim: acceptance by this checker is **not** proved to mean the
  endpoints are in the transitive closure of the rules.
- No Amu identity, no Definition CID equality — `SEC-PCC-SURFACE` stays UNVERIFIED.
- Only 4 of the 8 corpus pairs are expressible with the 5 rules as implemented
  (threading and the two-clause `case` need more rules).

## Reproduce

```bash
cd ~/pcc/src/acl2-8.7
cat ~/pcc/cells/checker.lisp ~/pcc/cells/tests.lisp | ./saved_acl2 > /tmp/c3tests.out 2>&1
grep -c 'ACL2 Error' /tmp/c3tests.out     # 0
grep RESULT /tmp/c3tests.out              # 13 lines

cat ~/pcc/cells/checker.lisp ~/pcc/cells/proofs.lisp | ./saved_acl2 > /tmp/c3proof.out 2>&1
grep -c 'ACL2 Error' /tmp/c3proof.out     # 2
grep -c 'Q.E.D.' /tmp/c3proof.out         # 5
```
