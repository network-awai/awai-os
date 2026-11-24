# SEC-PCC-SURFACE — cell 1: surface desugaring, ACL2 model + corpus checks

Status: **draft, MEASURED-ONCE (2026-11-24)**. Not admitted. Human research-lead
admission is the only way a claim leaves draft.

## What was measured

For 8 pairs of the surface-equivalence corpus, an ACL2 model of the desugar
contract maps the sugar spelling to the pure spelling and the result is compared
to the corpus's recorded pure form. Six of those pairs carry a `:control` whose
source changes the meaning; each control must **not** map to the same pure form.

Result of this run: **8/8 positives match, 6/6 controls differ.**

```
ACL2 !>(T T T T T T T T T T T T T T)
```

## Pins (all fixed for this run)

| Item | Value |
| --- | --- |
| Corpus repo | `kotoba-lang/kotoba-lang` @ `d3d5fff3` (origin/main) |
| Corpus path | `lang/surface-equivalence-corpus.edn` |
| Corpus blob | `93c9ed9cdf9491e49f8a24cb40f3857a25c09067` |
| Corpus sha256 | `62ecf9ec6302a9828fea34e58148342b65b169b73a794d8595b84474ffc44514` |
| ACL2 | 8.7, official release tarball `github.com/acl2/acl2` tag 8.7 |
| ACL2 tarball sha256 | `d6013c22e190cbd702870d296b5370a068c14625bf7f9d305d2d87292b594d52` |
| SBCL | 2.4.0, official `sbcl-2.4.0-arm64-darwin-binary.tar.bz2` |
| SBCL tarball sha256 | `1d01fac2d9748f769c9246a0a11a2c011d7843337f8f06ca144f5a500e10c117` |
| `saved_acl2` sha256 | `a88cf235aeeb0537878e38b7a4501fd75111517d3fe007f47e9f89b5e344bef9` |
| Host | `mini-201` (josephnoMac-mini.local), arm64, user space, no sudo |
| Build result | `make LISP=sbcl` → `BUILD_EXIT=0`, `Successfully built .../saved_acl2` |

## Reproduce

```bash
# on the host, after the pins above
cd ~/pcc/src/acl2-8.7 && ./saved_acl2 < ~/pcc/cells/cell1.lisp > run.out 2>&1
grep -c 'ACL2 Error' run.out      # 0
tail -n 3 run.out                 # (T T T T T T T T T T T T T T)
```

Model: `docs/research/pcc/cell1/sec-pcc-surface.lisp`. Run output:
`docs/research/pcc/cell1/run.out`.

## Scope — what this does and does not show

**Shown.** The ACL2 model implements `->`, `->>`, `cond` (with `:else`),
`if-not`, and `case` (one and two clause), and reproduces the corpus's pure form
for the 8 pairs whose sugar uses only those constructs. Each of the 6 controls
changes the meaning and is rejected, so agreement is discriminating rather than a
constant.

**Not shown, and must not be cited:**

1. **No termination proof.** The model is in `:program` mode; every check is a
   ground evaluation, not a theorem over all inputs. A proof of the model would
   need a measure over the mutual recursion, which was not attempted.
2. **No fidelity to Amu.** The model is Researcher's rendering of the contract,
   not the compiler. Nothing here shows that Amu agrees with the model.
3. **No Definition CID equality.** The corpus gate requires CID equality; this
   cell does not compute CIDs, for reasons measured below.
4. **8 of 21 pairs.** The other 13 pairs are out of scope: 8 are whole modules
   (ns-level), 2 carry no `:pure` at all (`:when-vs-if-else-0`, `:and-vs-if-false`
   — the corpus entry is incomplete), and 3 need destructuring/map/match forms
   the model does not implement.

## Why CID equality is out of scope (measured, not assumed)

- A native Definition CID is payload-v2 / dag-cbor / sha2-256 with **profile 6,
  desugar 2**, while the corpus's `:def-cid` values were recorded in the
  2026-09-08 ADR era (**profile 4, desugar 1**). Amu's own doc states a native
  source-derived CID "can never equal a frozen-vector CID"
  (`kotoba-lang/amu docs/definition-cids-native.md`), so the corpus CIDs cannot be
  reproduced by the current native route.
- `definition-cids` does not exist in `kotoba-lang/kotoba` at `bab283448`
  (`./bin/kotoba definition-cids` → `:command/unknown`, exit 1); it lives in the
  Amu seed as `seed/99-definition-cids-entry.kotoba`
  (`seed/DEFINITION-CIDS-MANIFEST`), and the prebuilt `bin/amu` on these hosts does
  not include it.
- Amu's doc records that `app` / `lam` / `ref` are **refused natively** (item A1).
  The corpus's measured pure forms for `:threading-vs-nested-app` and
  `:let-fn-vs-beta-redex` use exactly `(app (ref ..) ..)` / `(lam ..)`, so those
  two pairs cannot be CID-compared natively today.
- The corpus is not internally uniform: `:threading-vs-nested-app` spells the pure
  side as `(app (ref inc1) ..)`, while `:thread-first-vs-nested-call` spells the
  same idea as a direct `(g (g n))`. One desugar rule set cannot satisfy both
  conventions, so any CID claim needs the corpus's convention fixed first.

## Falsification conditions

- Any positive pair whose model output differs from the corpus pure form (this
  run: 0 of 8).
- Any control that maps to the same pure form as its positive (this run: 0 of 6).
- A change to the corpus blob, the ACL2 build, or the model that changes either
  count without a corresponding note here.

## Prerequisite (a), as measured

The handoff asked for `./bin/kotoba --help` to exit 0 at `bab283448`. It exits 1
with `:command/unknown`: no `--help` subcommand exists in any spelling
(`--help`, `help`, `-h`, no args all exit 1). PR #1379's own body uses
`./bin/kotoba --help` as the *reproduction of the failure*, not as a passing
check. The CLI itself is healthy: `./bin/kotoba check` parses and plans. This
cell therefore treats (a) as "the CLI runs in a clean checkout" and records the
substitution here rather than silently.
