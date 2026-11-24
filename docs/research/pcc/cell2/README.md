# SURFACE-MODEL-EVAL-2 — :logic ground equations accepted by ACL2; a false one is refused

Status: **draft, MEASURED-ONCE (2026-11-24)**. Not admitted.

Cell 1 measured the same thing in `:program` mode. This cell restates it in
ACL2's `:logic` so the equations are accepted without the `defthm`-on-`program`
error, and so the function can appear in a theorem at all. It covers **5 of the 8
pairs** — the ones whose desugaring is a pure structural rewrite.

## What these 9 theorems actually are

Every theorem is a **ground equality with no variables** (for example
`(equal (dg '(defn f (n :i64) :i64 (cond ...)) 200) '(defn f ...))`). ACL2 accepts
each one by **running the function and comparing**, which its own output shows:

```
Rules: ((:EXECUTABLE-COUNTERPART DG)
        (:EXECUTABLE-COUNTERPART EQUAL)
        ...)
```

`(:EXECUTABLE-COUNTERPART DG)` means the definition was used as a computation, not
that any rewrite rule about the desugar relation was applied. So this is the same
content as cell 1, written where `:logic` accepts it. **It is not a proof about
the desugaring relation and it is not a proof object.**

## Result

| Run | Ground equations accepted | ACL2 errors | Verdict |
| --- | --- | --- | --- |
| equations (as published) | 9 of 9 (5 positives + 4 controls) | 0 | accepted |
| one equation made false (`20` → `21` in the input of the `case` theorem) | 8 of 9 | 1, `ACL2 Error [Failure] in ( DEFTHM CASE-ONE-CLAUSE-VS-LET-IF ...)` | refused |

The second run changes the **claim**, not a proof: the input constant in the
equality is altered, so a false ground equation is submitted and ACL2 refuses it.
That is a check that ACL2 notices falsehood; it is **not** the check the earlier
handoff asked for ("corrupt the proof object and the checker refuses it"), because
no proof object exists here.

## Pins

| Item | Value |
| --- | --- |
| Corpus | `kotoba-lang/kotoba-lang` @ `d3d5fff3`, `lang/surface-equivalence-corpus.edn`, blob `93c9ed9cd…`, sha256 `62ecf9ec…c44514` |
| Checker | ACL2 8.7, tarball `d6013c22…b594d52`, `saved_acl2` `a88cf235…44bef9` |
| SBCL | 2.4.0, tarball `1d01fac2…e10c117` |
| Host | `mini-201`, arm64, user space, no sudo |

## Reproduce

```bash
cd ~/pcc/src/acl2-8.7
./saved_acl2 < surface-model.equations.lisp > run.out 2>&1
grep -c 'Q.E.D.' run.out        # 10  (9 equations + the model's own admission)
grep -c 'ACL2 Error' run.out    # 0

./saved_acl2 < surface-model.false-equation.lisp > run-false-equation.out 2>&1
grep -c 'ACL2 Error' run-false-equation.out   # 1  -> refused
```

## Scope

**Shown.**

- A fuel-bounded model (`measure (nfix n)`) computes exactly the recorded pure
  form for 5 of 5 positives, and the 4 meaning-changing controls are refused, in
  `:logic` mode where the function may appear in a theorem.
- A ground equation that is false is refused, and the refusal names it.

**Not shown:**

1. **No proof about the rules.** Ground equations discharged by execution say
   nothing about all inputs; there is no induction and no rule-level soundness.
2. **Termination is by fuel, not structural descent.** A structural version was
   attempted first and failed the measure conjecture
   (`ACL2 Error ... measure conjecture for DG, DG-LIST, DG-COND and DG-CASE-IF has
   failed`); that failure is recorded rather than hidden.
3. **No proof object, no certificate, no untrusted verifier.** This cell is not a
   PCC pipeline; see `../cell3/DESIGN.md` for the design that would attempt one.
4. **Threading (`->`, `->>`) is not in this model** — it carries an accumulator;
   those pairs remain evaluation-only in cell 1.
5. **No fidelity to Amu**, and **no Definition CID equality**. `SEC-PCC-SURFACE`
   stays UNVERIFIED.
6. **5 of 21 pairs, 4 controls.**
