# Prolly closure check and guarded local ref publication

`open-backend` has an explicit four-argument form accepting a trusted closure
verifier `(fn [get-block root-cid])`. Once the expected ref matches, it checks
the root block and invokes that verifier under the local writer lock before
publishing the ref. Only literal `true` permits publication; false, nil or an
exception refuses it. Supplying no verifier to the four-argument form is an
error. The existing three-argument form retains its prior root-only check.
The backend does not supply a closure algorithm or authenticate the caller's
verifier; selecting and qualifying one is an owning-layer responsibility.

On 2026-11-14 JST a local fixture oracle used the existing Kotoba `ipld.core`
CID verification, decoder and `links` functions to walk the batched Prolly
transaction's current root through the actual Otehon block port. A simple
bounded graph walk visited 12 distinct blocks / 3,998 verified block bytes /
15 link edges. The oracle refused a withheld child, wrong bytes for a child,
and block, byte, depth and edge limit controls. It then ran the same walk as
an explicit callback to the guarded backend: false and missing-child results
left the committed root unchanged, while a successful walk allowed the ref
CAS. The input store was a private copy; the original transaction evidence
was not changed. Both local Clojure CLI 1.12.5.1654 and Babashka 1.12.218
executed the check. The adapted Kotoba sources are the same pinned oracle
classpath recorded in `prolly_forest_writer_inputs.json`.

The hosted storage/ref/block/transaction suite passed 46 tests / 296
assertions locally. A real-tool two-Pack fixture also verified that a false
guard rejects without changing the root and a true guard allows CAS; its
hosted Linux CI execution is tracked separately. Neither the trusted callback
nor the local fixture walk is a shipped default verifier. The simple walk's
limits apply to graph counts and byte totals after reads; recursive decoding
and link collection within an individual block are not independently bounded
against hostile input. Its codec coverage is the existing Kotoba IPLD
primitive's, with this hosted port restricted to its accepted CID profile.
The experiment is not a generic hostile-input closure qualification, signed
basis or policy/receipt binding, Native proof, safe GC, distributed fencing or
production acceptance.

To repeat the oracle, first copy the prior batched proof's `store` to a new
private scratch directory and create an empty `staging` directory there; set
`KOTOBASE_TX_OUTPUT` to that copy and run `kotobase_prolly_closure.clj` with
the adapted Kotoba oracle classpath. The successful guarded CAS advances that
copy's root generation, so never point the oracle at irreplaceable evidence.
