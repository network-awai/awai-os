# SURFACE-MODEL-EVAL-1 — ACL2 model of surface desugaring, evaluated on 8 corpus pairs

Status: **draft, MEASURED-ONCE (2026-11-24)**. Not admitted. Human research-lead
admission is the only way a claim leaves draft.

**This is not a proof and not a PCC result.** There is no proof object here and no
verifier that checks one. What was measured is whether the model's *computed*
output equals the corpus's recorded pure form.

## Result (uniform rule, no function-name exception)

```
ACL2 !>(NIL T T T T T T T T T T T T T)
```

**7 of 8 positives match; all 6 meaning-changing controls differ (6/6).**

The one mismatch is `:threading-vs-nested-app`: the corpus writes its pure side as
`(app (ref inc1) (app (ref inc1) n))`, while `:thread-first-vs-nested-call` writes
the same shape as `(g (g n))`. One rule set cannot produce both, so under a uniform
rule that pair is **out of scope — corpus spelling not uniform**. It is not a
second rule and not an eighth success.

An earlier run of this cell reported 8/8. That run carried a `ref-name-p`
exception listing `inc1`, i.e. the model absorbed the corpus inconsistency with a
hard-coded name. The reviewer caught it. **That result is withdrawn and must not
be cited.**

## Pins

| Item | Value |
| --- | --- |
| Corpus repo | `kotoba-lang/kotoba-lang` @ `d3d5fff3` (origin/main) |
| Corpus path | `lang/surface-equivalence-corpus.edn` |
| Corpus blob | `93c9ed9cdf9491e49f8a24cb40f3857a25c09067` |
| Corpus sha256 | `62ecf9ec6302a9828fea34e58148342b65b169b73a794d8595b84474ffc44514` |
| ACL2 | 8.7, official tarball `github.com/acl2/acl2` tag 8.7 |
| ACL2 tarball sha256 | `d6013c22e190cbd702870d296b5370a068c14625bf7f9d305d2d87292b594d52` |
| SBCL | 2.4.0, official `sbcl-2.4.0-arm64-darwin-binary.tar.bz2` |
| SBCL tarball sha256 | `1d01fac2d9748f769c9246a0a11a2c011d7843337f8f06ca144f5a500e10c117` |
| `saved_acl2` sha256 | `a88cf235aeeb0537878e38b7a4501fd75111517d3fe007f47e9f89b5e344bef9` |
| Host | `mini-201` (josephnoMac-mini.local), arm64, user space, no sudo |
| Build | `make LISP=sbcl` → `BUILD_EXIT=0`, `Successfully built .../saved_acl2` |

## Reproduce

```bash
cd ~/pcc/src/acl2-8.7 && ./saved_acl2 < sec-pcc-surface.lisp > run.out 2>&1
grep -c 'ACL2 Error' run.out     # 0
tail -n 3 run.out                # (NIL T T T T T T T T T T T T T)
```

Model: `sec-pcc-surface.lisp`. Output: `run.out`.

## Why this is evaluation and not proof (measured)

Every model function is in `:program` mode and `defthm` count is **0**. ACL2
refuses to use a `:program` function in a theorem:

```
ACL2 Error [Translate] in ( DEFTHM SURFACE-1 ...):  Function symbols
of mode :program are not allowed in the present context.  Yet, the
function symbol DG occurs in the translation of the form
```

So the checks are ground evaluations, not theorems over all inputs, and no
certificate exists for a checker to verify. Cell 2 moves the model to `:logic`
with explicit measures plus one `defthm` per pair; that is separate work and its
result is recorded where it lands.

## Scope — what this does and does not show

**Shown.** A single exception-free desugar rule set (`->`, `->>`, `cond` with
`:else`, `if-not`, `case` one/two clause) maps 7 of 8 corpus sugar forms to exactly
the recorded pure form, and rejects all 6 controls that change the meaning, so
agreement is discriminating rather than constant.

**Not shown, and must not be cited:**

1. **No proof.** No termination proof, no `defthm`, no proof object.
2. **No fidelity to Amu.** The model is Researcher's rendering of the contract,
   not the compiler; nothing here shows Amu agrees with it.
3. **No Definition CID equality.** `SEC-PCC-SURFACE` keeps its CID-equality
   falsifier, so that claim stays **UNVERIFIED**; this cell is not it.
4. **7 of 21 pairs, 6 controls.** Out of scope: 8 whole-module pairs, 2 pairs with
   no `:pure` at all (`:when-vs-if-else-0`, `:and-vs-if-false`), 3 pairs needing
   destructuring/map/match, and the 1 spelling-inconsistent pair above.

## Why CID equality is out of scope (measured, not assumed)

- A native Definition CID is payload-v2 / dag-cbor / sha2-256 with **profile 6,
  desugar 2**; the corpus `:def-cid` values were recorded in the 2026-09-08 ADR
  era, **profile 4, desugar 1**. `kotoba-lang/amu docs/definition-cids-native.md`
  states a native source-derived CID "can never equal a frozen-vector CID".
- `./bin/kotoba definition-cids` → `:command/unknown`, exit 1 at `bab283448`;
  `amu definition-cids` → usage, exit 2. The command exists only as an Amu seed
  entry (`seed/99-definition-cids-entry.kotoba`, `seed/DEFINITION-CIDS-MANIFEST`)
  and needs an Amu selfhost build.
- Amu's doc records `app` / `lam` / `ref` as refused natively (item A1); both
  corpus pairs that carry CIDs use exactly those forms.
- The corpus is not internally uniform (the 7/8 mismatch above) and 2 pairs have
  no `:pure`.

Organizer decision for this cell: **(iii) CID equality out of scope**, with a
profile-6 re-measurement of the corpus requested as a separate Amu-side task.

## Falsification conditions

- Any positive pair whose model output differs from the corpus pure form (this
  run: 1 of 8, named above, attributable to corpus spelling).
- Any control that maps to the same pure form as its positive (this run: 0 of 6).
- A change to the corpus blob, the ACL2 build, or the model that changes either
  count without a note here.

## Prerequisite (a), as measured

The handoff asked for `./bin/kotoba --help` to exit 0 at `bab283448`. It exits 1
with `:command/unknown`; no `--help` subcommand exists (`--help`, `help`, `-h` and
no args all exit 1), and #1379's body uses it as the *reproduction of the failure*,
never as a passing check. The organizer confirmed the `--help` wording was their
error. `./bin/kotoba check` exits 0 in a clean checkout at
`~/orca/workspaces/kotoba/pcc-surface` (a1). Prerequisite (a2), a matching
Definition CID, was measured as not satisfiable today and reported as such before
this cell's ACL2 work.
