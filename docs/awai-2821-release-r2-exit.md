# AIUEOS release delivery: R2 exit plan

Status: proposal, 2026-11-13; AWAI-2821 under AWAI-438. Owner direction is to
stop using R2 for awai.network. This document covers `aiueos-releases` only;
it is not proof that every awai.network R2 dependency has been inventoried or
removed. No live route, bucket, worker or publication is changed by this plan.

## Existing contract

At awai-os revision `0af2ccd6312341deaaad8ddb2108e311fd237a9c`,
`distribution/wrangler.jsonc` binds R2 `aiueos-releases` to `RELEASES`.
`distribution/worker.mjs` serves GET/HEAD for stable/canary manifest paths and
digest-named ISO/NAR objects, with channel aliases, immutable object caching,
ETag and range responses. `distribution/upload-worker.mjs` implements a
signature-authorized multipart publication path; source presence does not prove
it is currently deployed. `nixos/update-ui.mjs` supplies the current Worker URL
to configured clients. `nixos/update-linux.mjs` independently admits the signed
manifest and streams the NAR with declared byte length and SHA-256 verification;
it rejects redirects. Existing installed configurations can retain the old URL,
so replacing only the source default cannot migrate them.

On 2026-11-13 a read-only Cloudflare API list returned two ISO objects, two NAR
exports and a stable manifest. ISO sizes were about 5.25 GB each, NAR sizes about
7.49 GB each. The response supplied no pagination metadata, so the complete
inventory is not yet independently established. The manifest was read, but its
signature and referenced object bytes were not independently verified. Multipart
ETags are not assumed to be SHA-256 or used as a CID. Listing access does not
establish bulk transfer credentials or the ability to run this job on VMs.

## Target and staged proof

Use AwaiFS/Yataverse content-addressed storage and independently placed Awai
nodes for artifact bytes, with a qualified service exposing the existing update
transport contract. The actual format, endpoint, operator and availability
guarantees are not yet qualified. A CID identifies bytes under its specific
codec; it does not itself prove availability, authentication, or equivalence to
the existing SHA-256. Manifest publication needs an authenticated, monotonic
channel-head mechanism separate from immutable artifact storage. Preserve the
existing signature, trust, freshness and anti-rollback checks; do not treat a CID
as a substitute. Avoid redirects unless existing clients explicitly support them.

1. **Inventory and pin:** obtain a complete paginated object listing and
   independently record key, size, version/ETag and capture time. Enumerate
   stable/canary manifests, consumers, historical installed configurations,
   publication credentials and writers. Detect changes between enumeration and
   byte reads. Define retention and sufficient capacity/network budget for the
   full set; the five observed objects alone total roughly 25.5 GB.
2. **Read-only import dry-run:** after AWAI-531 specifies the canonical codec and
   AWAI-2820 supplies an authorized suitable worker path, stream each source
   object to a task-owned staging area and calculate its full SHA-256 and size.
   Verify signed manifests against configured trust roots and match declared
   object digests and lengths. Create a deterministic object-to-CID mapping with
   codec/version/chunking and source snapshot identified. Never infer the hash
   from the object name without hashing bytes. Preserve evidence and do not
   alter the source bucket or production release channel.
3. **Independent retrieval:** place the candidate on at least two independently
   controlled nodes/failure domains; reconstruct each full byte stream on a
   separate node and compare SHA-256 and size against R2 and the admitted
   manifest. Test interrupted transfer, corruption, unavailable node, recovery,
   and full-size resource limits. The existing AWAI-2820 fixed simulation
   cross-host readback is useful platform evidence, not this release-data proof.
4. **Compatibility:** test GET, HEAD, aliases, status and headers, byte ranges,
   large streams, timeouts, absent objects and manifest freshness against the
   old and candidate services. Verify the actual installed updater paths and
   signature, hash, anti-rollback and recovery gates. Document any differences
   and their client migration rather than assuming wire compatibility.
5. **Publisher and head:** qualify a non-R2 publishing route with authenticated
   authorization, immutable object verification, independently durable placement,
   monotonic signed channel-head promotion, concurrent publisher fencing and
   rollback. Rehearse publishing and recovering a synthetic release. Capture
   signed manifests as immutable objects and preserve the channel history.
6. **Release and cutover:** publish a candidate and verify from independent
   clients, then separately obtain approval for the exact production route and
   installed-client migration. Record compatibility and recovery evidence. Keep
   R2 intact as rollback until that cutover and data-retention decisions are
   explicitly complete. Remove bindings, publisher, Worker and objects only in
   their separately reviewed stages; verify both source and deployed state.

## Exit criteria and unresolved dependencies

All referenced releases must have complete, independently verified bytes and
qualified replica recovery; clients must get a compatible authenticated feed;
publisher and channel-head recovery must be proven; and the final route change
must receive separate approval. Source edits, staging, dry-run, deployed candidate
and live R2 retirement are different milestones. AWAI-531 format qualification,
AWAI-2820 worker acceptance, bulk read capability, service selection, placement,
publisher design and installed-client migration remain open. Re-inventory other
awai.network R2 bindings before claiming network-wide R2 elimination.
