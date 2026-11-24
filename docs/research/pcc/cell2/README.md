# SURFACE-MODEL-EVAL-2 — :logic model, one defthm per pair, certificate rejected when corrupted

Status: **draft, MEASURED-ONCE (2026-11-24)**. Not admitted.

Cell 1 measured evaluation (no proof, no certificate). This cell puts the same
idea in ACL2's logic with a real proof object, so a checker can accept or reject
it. It covers **5 of the 8 pairs** — the ones whose desugaring is a pure
structural rewrite.

## Result

| Run | Theorems proved | ACL2 errors | Verdict |
| --- | --- | --- | --- |
| certificate (as published) | 9 of 9 (5 positives + 4 controls) | 0 | **accepted** |
| certificate with one constant corrupted | 8 of 9 | 1, `ACL2 Error [Failure] in ( DEFTHM CASE-ONE-CLAUSE-VS-LET-IF ...)` | **rejected** |

So the checker is discriminating: the same checker that accepts the certificate
rejects the corrupted copy, and names the theorem whose statement no longer
holds.

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
./saved_acl2 < surface-model.certificate.lisp > run.out 2>&1
grep -c 'Q.E.D.' run.out          # 10  (9 theorems + the model's own admission)
grep -c 'ACL2 Error' run.out      # 0

./saved_acl2 < surface-model.corrupt.lisp > run-corrupt.out 2>&1
grep -c 'ACL2 Error' run-corrupt.out   # 1  -> rejected
```

## What "certificate" means here, and what it does not

The certificate is the file of `defthm` forms; the checker is ACL2's kernel
running it. Corrupting a statement makes the kernel refuse it. That is a real
proof-object/checker pair in the narrow sense, and it is **all** this cell shows.
It is not a PCC pipeline: nothing transports the certificate as a standalone
artifact to an untrusted peer, and the checker trusts the whole ACL2 kernel, so
this does not reduce the trusted base below "ACL2 is correct".

## Scope

**Shown.**

- A fuel-bounded model (`measure (nfix n)`) maps each of 5 corpus sugar forms to
  exactly its recorded pure form, as a proven theorem, not an evaluation.
- The 4 meaning-changing controls are also proved (as `not equal`), so acceptance
  is discriminating.
- Corrupting one theorem's constant causes exactly that theorem to be rejected.

**Not shown:**

1. **Termination is by fuel, not by structural descent.** Every recursive call
   decreases `n`; a result is exact only when `n` exceeds the term's depth. This
   proves the *equations* hold, not that the function is defined without a bound.
   A structural version was attempted first and failed the measure conjecture
   (`ACL2 Error ... measure conjecture for DG, DG-LIST, DG-COND and DG-CASE-IF has
   failed`); that failure is recorded rather than hidden.
2. **Threading (`->`, `->>`) is not in this model** — it carries an accumulator.
   Those pairs remain evaluation-only (cell 1).
3. **No fidelity to Amu**, and **no Definition CID equality**. `SEC-PCC-SURFACE`
   stays UNVERIFIED.
4. **5 of 21 pairs, 4 controls.**
