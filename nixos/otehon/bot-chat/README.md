# Itonami Agent conversation service (Otehon)

## Private mail aliases (AWAI-328)

The same independent owner-authenticated Agent service exposes exactly
`POST /v1/mail/aliases/list`, `/issue`, `/stop`. Each is a distinct browser
operation with fresh canonical consent. No automatic read or app-origin API is
introduced. `mailAliasBindings` in the digest-pinned owner service config must
explicitly list `{botId, principalId, did, epoch, actions, signature}`. Principal
IDs are stable UUIDs; only Ed25519 did:key bindings are currently supported.
`bindingStatement(binding)` supplies the exact UTF-8 signing bytes; signature is
standard base64 Ed25519. Verify the statement using the existing identity signer
and install the public binding in owner configuration. This does not create or
export a signing key. A self-signed DID supplied by a request does not authorize
a principal: owner configuration is also required. Missing/revoked/forged
bindings fail closed. A replacement key needs a newly owner-approved binding
and proof, retaining the principal ID and epoch advancement; did:key itself is
not a mutable/rotatable identifier. No production bindings were provisioned by
the synthetic tests.

Issue requests bind an operation UUID and previous directory head. Addresses
use independent 160-bit random local parts; private purpose/counterparty and
binding data become encrypted Kotobase events over AwaiFS Pack/CAR. Stops append
tombstones. Existing IDs/addresses are never reassigned; same request ID returns
the saved result and refuses changed input. Stale heads refuse before writing.
UI retains an uncertain issue UUID for explicit result checking. Reads recover
from durable storage in a new process. This reuses the existing database crypto
profile and host key custody below; it is not canonical-envelope E2EE or
independent-node recovery qualification. Current addresses are **reserved**:
no SMTP ingress/egress, Google MX changes, source-cron send authority or public
fleet aliases are created. Stopped/expired addresses are refused by the alias
selector; a future gateway must enforce these states at each delivery/send.

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

Named sessions use the exact pinned canonical Itonami Otehon conversation/peer modules in `vendor/agent-session-source.json`. Both Itonami and Soshiki render the same conversation component. The peer worker is a separately approved, one-cycle host operation: its goal/grant/participants/source hashes and owning Issue are pinned; authenticated etcd admission is checked again before inference. Unknown outcomes recover only the original saved result or read the original Agent session; no model retry. The public presence/progress files contain metadata only and expire or retain dated completion facts; a shared service is never individual Bot residence. Ordinary browser DNS is owner-deferred; the bounded operator pilot explicitly resolves the known Tailnet address with full TLS verification. Original cron and held jobs are unchanged.

The 1000ms spacing in the pilot occurrence ledger orders its four talk turns;
it is not a Bot cron frequency or a Linear Cycle. Product Bot cycles remain the
original source cron, whose expressions/timezones/next slots are retained as
context. The one-off dialogue grant does not authorize recurring new cycles.
