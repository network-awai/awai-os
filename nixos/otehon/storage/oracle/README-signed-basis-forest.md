# Signed logical checkpoint over Forest: hosted reference — 2026-11-14 JST

This experiment composes the existing `kotobase.engine.identity` logical
commit and signature payload, `kotobase.engine.frontier/accept-head`, a
pinned Ed25519 implementation, the Forest-backed Prolly engine and the
existing Dango/policy/Datalog query oracle. A writer computes a checkpoint by
scanning the restored Prolly snapshot, signs the logical-commit root, and
publishes the proof as a CID-addressed raw EDN block in its own Forest group.
A fresh JVM process recovers that proof and the separate data group, recomputes
the complete logical checkpoint, checks the issuer/key, root, signature,
database, epoch, checkpoint and supplied policy identifier, and passes the
verified entry through the frontier's initial acceptance before running the
existing query oracle. The Prolly physical root is not used as the logical
checkpoint. A future physical layout can change provided the recovered state
produces the same logical checkpoint.

On macOS arm64, Clojure CLI 1.12.5.1654, the two-process experiment passed.
The recovered proof block CID was
`bafkreib4qri4wdvkscjtakaclseteup43hqf4zosg22wk23rwlbktwhfum`;
the logical checkpoint hash was
`96175270cf9bdf970dfcb645a3d9faf40efd26adfc773b1c802a4a164a12783a`.
Modified root, checkpoint, signature and issuer, as well as mismatched expected
checkpoint and policy identifier, were rejected. The existing query oracle
returned the expected row and denied wrong capability basis, expired, altered
seal and revoked token cases. These are separate negative controls; they do
not establish revocation distribution or transaction history integrity.

This is an experiment, not a product signed-data-commit implementation. The
proof uses raw EDN and a SHA-256 hex logical root as injected test encoding;
the signing key, trust anchor and policy identifier are fixed fixtures. The
policy identifier in the signed commit is **not** the real policy CID. The
tx, schema and model roots are placeholders, and no parent history is checked;
initial frontier acceptance is TOFU, with no secure persisted frontier. The
proof and data use separate publications, and no crash-atomic binding between
them is established. The signature is checked against the recomputed logical
snapshot; it does not authenticate the transaction history, deployed key
custody or concurrent writers. The scripts trust a local test classpath and
run the query oracle as a separate fixture step after validation, not through
an integrated product query admission API. OS cache loss, physical power loss,
Native behavior and production qualification remain unverified.

The adapted Kotoba engine and other oracle sources are pinned by
`prolly_forest_writer_inputs.json` and its referenced prior inputs. In this
run, adapted `identity.cljc` SHA-256 was
`fef4483244f5cabe0c9da23021622792772fa97d58e097cf67b2b8145bb6a349`,
`frontier.cljc` was
`9b0c26fb34f7fd429bcfd3c29b3d2697a1423d37a7b1eb0e37fa88e1290afaf6`,
and the pinned Forest tool was
`e5fb23076a46c055142b3dbf3efa1ad5a68532d14419ad9994785986719b205f`.
No dependency download was required.

To repeat, prepare the writer data group and adapted classpath as in
`README-prolly-forest-writer.md`; set `GROUP_FOREST_STORE` to that data group,
`FOREST_TOOL` to the pinned tool, and `SIGNED_BASIS_OUTPUT` to a new private
scratch path. Run `signed_basis_forest.clj write` and then `read` in separate
JVM processes with the same classpath as `prolly_forest_writer_policy.clj`.
The writer requires a new output path and retains its artifacts. The JVM is a
local reference oracle and is not the Native runtime, a CI gate, or fallback.

## Policy CID bound to the recovered snapshot — follow-up

The earlier results above describe the first fixture with a placeholder policy
identifier. The current script replaces that placeholder: it scans the same
recovered Prolly snapshot for `kotobase.policy/read`, reconstructs the policy
with `kotobase-peer.policy/policy-of`, computes its actual `policy-cid`, and
places that CID in the signed logical commit. After a fresh process recovers
the proof and data, it recomputes both checkpoint and policy CID and checks
them before querying the same snapshot using that policy and a Dango fixture
capability. The allowed join returned its expected row, while the wrong-basis
capability returned no rows. A separately computed CID for an altered policy
was rejected by frontier admission before the query callback ran. Signature,
root, issuer, checkpoint and expected-policy mismatches were also refused.

The follow-up proof block was
`bafkreibwiklgiqli7tecvfx7bobfvgord4cswimcp2q576t32lrhapwvaq`, and the
policy CID was `bafyreidttvee6r2pduhuwto6ft4xmolglspprk4sseuhorsdpbchbswkuu`.
The same local Clojure CLI, adapted classpath and separate-process procedure
were used; no additional dependencies were downloaded. The capability roots,
keys, clock and query are test fixtures. The earlier policy-identifier
limitation no longer describes the current script; the remaining authority,
history, separate-publication, persisted frontier, Native and cache-loss
limitations above still apply. This oracle does not implement product admission.
