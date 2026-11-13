# Hosted signed checkpoint and Prolly blocks in one Forest group

This extends the hosted reference in `README-signed-basis-forest.md`.
The writer reconstructs the real Prolly snapshot and policy from the prior
fixture, creates the same signed logical checkpoint and then writes its proof
block and all 18 Prolly fixture blocks, plus two deterministic 600 KiB raw
padding blocks, as one 21-block Forest group. The two padding blocks force the
bounded writer to produce two archives. The group root points to the proof;
its physical-root field locates the Prolly data, but is not itself signed.
Recovery validates the signed logical checkpoint against the recomputed full
snapshot and real policy CID, so changing the location cannot authorize a
different recovered logical state with a different checkpoint.

On 2026-11-14 JST a fresh JVM process recovered the group with neither the
original data-store path nor the Forest writer tool supplied. It accessed
both archives, verified the proof and complete checkpoint and policy, ran the
same snapshot's Dango/policy/Datalog allow and deny cases, and passed the
signature/root/checkpoint/issuer and changed-policy negative controls. The
proof CID was `bafkreigfbzgc3xh4uel37eg7msupniof57qzp2kp6jo3yg2mpo3vepw55a`.
Independently copied stores with either one of the two archives moved aside
failed recovery with `committed Forest archive is missing`; both original
archives and all test copies were retained. This is a missing-pack test, not
an actual crash or power-loss test.

The writer uses existing `put-ipld-blocks!` and the existing group WAL/root
publication. The prior writer test covers process interruption in generic
multi-Pack publication; this exact signed-proof workload was not killed during
publication. The proof and data now share the same group publication, but
this experiment has no production query adapter or integrated receipt sink.
The proof is fixture EDN and its root is an injected hash, not a standardized
signed commit artifact. Keys, clock, capability, transaction/schema/model
roots, secure frontier and authority are fixtures or absent. It does not
establish signed transaction history, multiwriter fencing, Native I/O, OS
cache loss, power-loss durability or production qualification. This small 2-Pack fixture behavior does not establish GiB performance.

Reproduce with the prior adapted classpath and data-group setup in
`README-signed-basis-forest.md`. Run `signed_basis_multipack.clj write` with
`GROUP_FOREST_STORE`, `FOREST_TOOL`, and a new `SIGNED_BASIS_OUTPUT`; in a
fresh process, run `read` with only `SIGNED_BASIS_OUTPUT` and the classpath.
The writer creates and retains its private output directory. JVM execution is
a local reference oracle and is not a Native runtime or CI fallback.
