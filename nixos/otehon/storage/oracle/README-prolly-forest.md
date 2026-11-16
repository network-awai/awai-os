# AWAI-532: persisted Prolly snapshot in Forest — 2026-11-13 UTC

A local hosted reference proof joins the existing Kotoba Prolly provider and
async Datalog executor to Otehon storage. A 12-block Kotoba Prolly fixture
from AWAI-174 was encoded as CARv1 and compressed with pinned Forest
`e5fb23076a46c055142b3dbf3efa1ad5a68532d14419ad9994785986719b205f`,
`--frame-size 1`. The committed archive is 5,841 bytes; its physical SHA-256
is `dfa891a42b2a5516ab7d222be690ed4f39c38ad751bd5cecb86992509c14d32d`.
The 12 input block hashes, bridge and exact staged source hashes are in
`prolly_forest_inputs.json`; the logical Prolly root is
`bafyreiakmttcp6otxvnyqmdjpzlschlskibp7enadlvkguw3nnp47f5wqm`.

`prolly_forest_store.clj publish` verifies the archive and root, stores the
Forest bytes, and publishes its reference via the real Otehon WAL/root
transaction. A separate Node process runs `prolly_forest.cljs`, reads the
published reference and uses separate hosted Babashka processes to obtain
blocks by CID. It restores the real asynchronous Prolly provider and exercises
an async four-clause Datalog join, current and as-of scans, and a test predicate
that hides a join attribute. Output:

```
Forest-backed async Datalog join, visibility filtering and as-of scans passed; block reads 32
```

A flipped archive byte was refused as `Forest digest mismatch`; withholding
the committed archive was refused as `committed Forest archive is missing`.
Both tests used separate task-owned store copies and process exit 1. There is no
silent fallback to an older state. The original store and fixture are intact.

Run the hosted portion with Babashka 1.12.218 and the repository-root classpath:

```
export PROLLY_FOREST_STORE=.agent-output/prolly-forest/store
bb --classpath nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src nixos/otehon/storage/oracle/prolly_forest_store.clj publish
```

Compile `prolly_forest.cljs` as namespace `awai-oracle.provider-forest` with
the staged Kotoba source classpath from the AWAI-174 Prolly oracle in
[kotoba PR #1334](https://github.com/kotoba-lang/kotoba/pull/1334), adapted
for ClojureScript 1.12.42 as described there, and run the generated Node
script with the same `PROLLY_FOREST_STORE`. The measured run used Clojure CLI
1.12.5.1654 and Node 26.0.0. No dependencies were downloaded for this run.

The bridge is an oracle, not a product storage adapter: each request reopens
and fully validates the <=1 MiB archive, so these are CID-index lookups, not
proof of physical random reads. The fixture uses identity encryption, synthetic
blinding and a test visibility predicate. This does not verify a signed basis,
real capability or receipt, multi-Pack publication, OS cache loss, native I/O,
remote durability or production readiness.
