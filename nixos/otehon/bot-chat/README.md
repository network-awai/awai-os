# Itonami Agent conversation service (Otehon)

AWAI-2808. The Agent owns conversation state. Browser persistence is not used.
The database is the real pinned `kotobase-peer` CLJC engine over the existing
Otehon AwaiFS Pack/CAR + WAL adapter. `vendor/sources.json` lists byte hashes,
upstream revisions and licenses for the historical CLJC dependency capsule.
This bounded Otehon consumer does not qualify current Kotoba/Amu selfhost or
replace the canonical Kotobase source. No vendored engine source is modified.

The private host adapter encrypts each Kotobase transaction payload using
Java AES-256-GCM with a random 12-byte nonce and database-specific AAD. The
opaque ciphertext supplied to Kotobase is an IPLD-encoded version/nonce/ciphertext
container. HMAC-SHA256 supplies the engine's blind-index port. This is a
provider-local Otehon database crypto profile, not an AwaiVol or Native envelope
interoperability claim. The private key remains on the Agent host, mode0600;
conversation directories are mode0700. Missing keys on an existing store fail
closed. Off-host key recovery and distributed private-state replication remain
separate qualification work.

Immutable Kotobase blocks are durably published as canonical CAR-backed AwaiFS
objects before a conditional head publication. A fresh recovery and query verify
each acknowledged append. Duplicate message IDs are idempotent only for identical
bytes; conflicting IDs cannot overwrite history. The service must retain an
uncertain invocation instead of automatically reissuing inference.

Run `node --test nixos/otehon/bot-chat/test/database.test.mjs` from the repository
with Babashka installed. The test checks source hashes, actual library execution,
process-independent recovery, duplicate/conflicting IDs, permissions, encrypted
payloads, missing/wrong keys and CAR corruption. Native paths do not depend on
this Otehon check. Service HTTP, Muse and browser qualification are distinct from
these database checks.
