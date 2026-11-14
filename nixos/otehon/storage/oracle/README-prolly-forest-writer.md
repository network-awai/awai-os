# AWAI-532: generic IPLD blocks to atomic Forest group — 2026-11-13 UTC

`otehon.forest-writer/put-ipld-blocks!` accepts canonical CID strings and raw
block bytes, checks each SHA-256 CID, rejects duplicate CIDs or a missing basis,
and uses the existing digest-pinned Forest compressor to build CARv1/Forest
archives. It verifies every generated block and CID against the input before
publishing the complete group via `publish-group!`. The caller's block bytes are
cloned. Staging is newly created, private and retained on success or failure.
This validates content identity; it does not independently validate the
semantic canonicality of every DAG-CBOR or DAG-PB block.

The hosted profile accepts CIDv1 SHA-256 raw, DAG-CBOR and DAG-PB blocks,
<=850 KiB each, <=32 MiB total input, <=64 blocks per archive and <=64
archives. Archive CAR payloads are capped at 900 KiB before compression;
existing Forest validation caps each archive at 1 MiB compressed and decoded.
Input and generated archives are buffered in memory, so these bounds do not
establish a 32 MiB peak RAM bound. This is not a streaming or GiB writer.

Local proof used the real pinned Forest v0.39 tool, 18 Prolly fixture blocks
plus two seeded 600 KiB raw blocks interleaved so the Prolly data spans both
archives. A separate reader verified all 20 byte/CID pairs, accessed both
archives and confirmed the basis. CID mismatch, duplicate CID and an untrusted
tool were refused without changing the published root. A separate JVM oracle
restored the generated group, read both archives with positioned I/O, ran the
real Datalog join and Kotobase policy, and checked a real Dango test-key
signature: the basis-bound capability allowed the expected row; wrong basis,
expiry, modified seal and supplied revocation returned no rows. It observed
23 frame reads / 24,388 compressed bytes including repeated reads.

An additional hosted proof ran the actual compressor and writer in a child
process, stopped it at second-archive half-write, root half-write and root
rename, then used fresh processes to verify old/new complete blocks and retry.
All 3 cases passed. The existing Otehon local unit suites passed 40 tests / 302
assertions. Source, staged classpath and tool hashes are in
`prolly_forest_writer_inputs.json`. The forest-writer-linux Otehon CI job runs
both writer proofs; Nix and that exact CI artifact were not available locally.

Reproduce the hosted write and read proofs with the repository classpath and a
pinned Forest tool; pass `write <new-private-scratch-dir> <tool>` and then
`read <same-dir> <tool>` to `test/otehon/ipld_forest_writer_proof.clj`. The
process-kill proof takes `run <new-private-scratch-dir>` with `FOREST_TOOL` set.
The prior `README-prolly-forest-policy.md` documents the adapted JVM oracle
classpath. The oracle invokes Dango with deterministic test keys and supplies
revocation and time; identity encryption and synthetic blinding are used.

This result does not prove signed commits or basis, durable execution receipts,
Native Forest I/O, a GiB-scale generic writer, OS cache loss, disk power loss,
independent-node fencing or production authorization. Process-kill recovery
is not OS-cache loss. The writer stages complete inputs and prebuilt archive
bytes; it does not consume an unbounded stream.
