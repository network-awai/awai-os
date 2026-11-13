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

The independent Agent protocol service binds only to loopback port 8912. Its
private Tailscale HTTPS route on port 8443 checks the injected owner identity
and an exact browser-origin allowlist. The static application origin has no
conversation API or database. Both history reads and sends use the canonical
client operation broker and a fresh user choice. Browser memory holds only
the currently displayed messages and draft; reloading history reads the Agent.

Conversation uses digest-verified catalog SOUL bytes and a separately declared,
tool-free Muse / Meta / `muse-spark-1.3` rail. It does not activate cron jobs,
change original profile inference, or grant tools. Missing verified personas
refuse a send. The Agent durably accepts a request before inference; completed
request IDs replay their saved result, while uncertain outcomes refuse
redispatch. Generic interactive usage is unallocated, with Bot/run/model and
raw provider usage recorded privately; it is not charged to AWAI-2808.

Run `node --test nixos/otehon/bot-chat/test/*.test.mjs` for database, HTTP
identity/origin/idempotency/restart and canonical Muse-result checks. HTTP tests
use a synthetic executor and real Kotobase/AwaiFS; they do not prove a live
Meta inference call. Never place conversation payloads in public fleet reports.
