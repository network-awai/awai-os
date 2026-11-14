# AWAI-532: positioned IPLD Forest retrieval — 2026-11-13 UTC

`otehon.ipld-forest` publishes a bounded generic IPLD Forest archive and root
through the Otehon WAL/root store. It verifies the complete archive and CAR
root at publication and again on recovery. A recovered handle retains only
index and frame-digest metadata, and `get-block` uses positioned reads to fetch
and revalidate candidate frames and CIDs. A returned absence is relative to
the previously verified snapshot; it is not a fresh archive-wide scrub.

Local Babashka v1.12.218 tests: 4 tests / 28 assertions pass. They cover all
12 DAG-CBOR fixture blocks, positioned I/O, absent CID, root mismatch without
publication, missing object, changed candidate frame, full-recovery corruption,
and an injected interruption between object rename and catalog publication.
The interruption is an exception injection, not a process kill or power cut.
`check.nix` runs this Otehon suite; no Native gate depends on it.

The positioned local oracle publishes the fixture in one hosted process. A
second long-lived hosted process recovers the catalog once and answers CID
requests with the product `get-block`; a separate Node 26 / ClojureScript
1.12.42 process restores the real Prolly provider and runs the four-clause
Datalog join, as-of scans, and test visibility denial. Output:

```
Positioned Forest Datalog join, visibility and as-of passed; requests 32 frames {:frame-reads 32, :frame-bytes 17256}
```

The 32 requests include repeated blocks; this is not a throughput benchmark.
On separate copies, corrupt and missing archives each caused process exit 1
at recovery, with a digest mismatch and missing archive respectively. Staged
source, bridge, fixture and classpath SHA-256 values are recorded in
`prolly_forest_positioned_inputs.json`.

For reproduction, stage the adapted Kotoba classpath identified in the prior
`README-prolly-forest.md`, copy `prolly_forest_positioned.cljs` to namespace
`awai-oracle.provider-forest-positioned`, and compile with ClojureScript
1.12.42. Set `PROLLY_FOREST_STORE` to a new private scratch path; run
`prolly_forest_positioned.clj publish` with the Otehon source/vendor classpath,
then the Node artifact with the same variable. Neither source oracle nor
synthetic identity crypto is included in the native runtime.

Scope remains a single <=1 MiB Forest archive and one named catalog entry.
The Node/Babashka bridge is a test adapter, policy is a test predicate, and
crypto is synthetic. This does not establish a complete Prolly blockstore
writer, signed basis, actual authorization or receipt, concurrent writer
fencing, Native Forest I/O, GiB-level query, OS cache loss or production
qualification. The existing multi-Pack file writer is a separate profile.
