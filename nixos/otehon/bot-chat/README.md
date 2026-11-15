# Itonami Agent conversation service (Otehon)

## Automatic identity and private mail (AWAI-2933 / AWAI-328)

The same independent owner-authenticated Agent service exposes exactly
`POST /v1/mail/aliases/list`, `/issue`, `/stop`. Each is a distinct browser
operation with fresh canonical consent. No automatic read or app-origin API is
introduced. Owner-only POST /v1/mail/identity/status and /recover operations
have separate fresh consent. Domain logic is CLJC under src/itonami_identity/:
pure mail policy, custody, registration ledger and host adapter. The former
mail-aliases.mjs domain implementation was removed; existing Node HTTP/process
plumbing calls the CLJC host only.

The digest-pinned owner config sets identityRoot, identityNamespace,
identityCustody: {type: "macos-keychain"}, identityEtcdConfig, and
identityAutoEnroll: true, and an explicit identityAllowedBots list compiled from
the owner's digest-pinned profile manifest. Only these approved catalog profiles
are accepted by the HTTP host. Startup enrolls that catalog in bounded batches;
reconciliation resumes interrupted enrollment and newly registered profiles.
New profile IDs require an owner policy update; an unsigned public report or
request cannot widen this enrollment allowlist. The host checks the CLJC boot
acknowledgment schema/count before reporting enrollment completion. Stable principal
UUIDs and existing D7 per-profile Ed25519 derivation are persisted with structured
key-possession signatures; a DID supplied in a request cannot authorize itself.
Registration uses authenticated three-endpoint etcd CAS in a separate
/itonami/identity/v1/ namespace and independent encrypted Kotobase/AwaiFS
readback. CAS claims contain public bindings only. No occurrence/funding grants
are reused. Current enrollment supports epoch0 and refuses conflicting bindings;
key rotation is a separate transition, never an implicit new identity on boot.

The new identity store uses a Keychain-held primary credential and a separate
Keychain recovery credential. Secrets enter /usr/bin/security private stdin,
not argv/env/logs. The seed, recovery wrap and database use the existing Otehon
database AES-GCM/IPLD crypto port; no new cipher is defined. Raw master keys are
not written into the identity database. This is the existing provider-local
crypto profile, not canonical hybrid-envelope/Native interoperability.
Missing/corrupt custody in an initialized namespace refuses; recovery unwraps
the original primary and preserves principal, DID and aliases. Do not delete
namespace markers to recover. Same-UID host compromise is outside this isolation
boundary; OS Keychain alone does not make arbitrary local agents untrusted.

Native owner JSON commands export-recovery (new absolute output directory)
and restore-recovery (bundle, private0600 ownerKeyFile, known botId) are
available via bb --classpath <host-classpath> -m itonami-identity.core, with
{config,request} on stdin. They are deliberately absent from HTTP routes.
The export contains a ciphertext directory plus a separate private owner key
file. Store that key separately from the ciphertext and retain it before a
whole-device/Keychain loss. Restore requires a new namespace target and
authenticates the wrapped primary before copying; it refuses existing targets.
Exports contain no live Keychain entries or conversation master keys. Portable
restore is tested in separate processes/stores; independent hardware recovery
and production off-host backup are separate operational qualification.

Issue requests bind an operation UUID and previous directory head. Addresses
use independent 160-bit random local parts; private purpose/counterparty and
binding data become encrypted Kotobase events over AwaiFS Pack/CAR. Stops append
tombstones. Existing IDs/addresses are never reassigned; same request ID returns
the saved result and refuses changed input. Stale heads refuse before writing.
UI retains an uncertain issue UUID for explicit result checking. Reads recover
from durable storage in a new process. Each alias directory's committed head
is also anchored by authenticated etcd CAS. A write reserves a pending request
before local publication and acknowledges only after durable readback and head
publication. The complete request/event intent is first encrypted into the
Agent database, and its digest is bound into the pending authority. An
interruption before the alias append can resume that same private intent after
browser/process loss; the browser is not the recovery source. An interrupted
head update reconciles the same persisted event;
a restored old snapshot cannot reactivate a stopped alias or write over newer
state. A pending request without a local result requires resuming the same
request; it is never silently discarded. This reuses the existing database crypto
profile and Keychain custody above; it is not canonical-envelope E2EE or
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
