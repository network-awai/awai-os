# AWAI-532: atomic generic IPLD Forest group — 2026-11-13 UTC

`publish-group!` verifies 1–64 bounded generic Forest archives, their individual
CAR roots and the selected basis block before writing immutable archives and
publishing one group reference through the Otehon WAL/root transaction. A
recovered group validates every archive and the basis before serving any CID;
`get-group-block` consults each verified index and uses positioned, reverified
frame reads. Per-archive compressed and uncompressed bounds remain 1 MiB. This
is an ordered catalog with a writer lock, not writer fencing or a strong
cross-node transaction.

The 18-block policy-bearing Prolly fixture was split into two disjoint CARs,
compressed by the pinned Forest tool with `--frame-size 1` and published as a
single group. Separate-process JVM reference execution used the real Prolly,
Datalog, Dango Ed25519 and `kotobase-peer.policy` implementations. It read
from both physical archives (23 positioned frames, 24,388 compressed bytes),
returned the expected query row for a basis-bound test capability, and returned
no rows for a wrong basis, expiry, tampered seal and supplied revocation.
Fixture/source/classpath/tool hashes are in `prolly_forest_group_inputs.json`.
The selected basis and deny inputs are the same as `README-prolly-forest-policy.md`.

Local Otehon test suite: **40 tests / 302 assertions**, all passed. A separate
hosted process-kill runner stopped the writer at seven points: second Forest
archive half-write/rename, WAL half-write/rename, root half-write/rename/dir
sync. A fresh process verified all 18 blocks from a copied record set after
each stop, saw the old group before root publication or the new group after,
and verified a successful retry. This is process termination with copied
records, not an OS reboot or a physical power cut. `check.nix` runs these
Otehon tests; Nix was unavailable on the local host.

Test keys, identity encryption, synthetic blinding, host-provided revocation
and time, and JVM oracle adaptations remain as in the prior policy proof.
This does not establish signed commits, durable receipts, remote persistence,
Native Forest I/O, GiB-scale query, operating-system cache loss, fencing or
production authorization. The external compressor is used to prepare the
fixture; the product group API imports already produced Forest bytes rather
than constructing them from a stream.
