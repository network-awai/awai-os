# Agent identity enrollment for private mail

Design record, 2026-11-15. Tracking: [AWAI-2933](https://linear.app/kotobalabs/issue/AWAI-2933),
parent [AWAI-328](https://linear.app/kotobalabs/issue/AWAI-328).
This records the design and its CLJC implementation. Source, synthetic recovery,
live owner-host enrollment and independent hardware qualification are separate.

## Verified source inventory

Agent main revision `901054ab87e10dc50f31750342223e86d1274fe9`:

- `src/itonami/agent/identity.cljk:20-64` derives a profile's Ed25519 did:key
  from a supplied fleet seed, stable derivation ID and epoch. It does not create
  or durably enroll the seed. `profile did` refuses without the seed.
- `otehon/src/itonami/otehon/cli.cljc:1865-1895` exposes the corresponding
  explicit Otehon `profile did` command. Reuse this existing identity derivation;
  do not replace it or claim an automatic lifecycle from command presence.
- `src/itonami/agent/profile.cljk` loads an existing profile and its settings;
  loading is not principal registration or DID proof publication.
- `src/itonami/agent/p2p.cljk:87-104` loads/creates a **node** Ed25519 key.
  That machine identity is distinct from each agent's identity.

Legacy `cloud-itonami-app` source in the preserved `emotional-bots` worktree
has `bot_identity.clj:67-85` (first-use fleet seed) and `bots.clj:910,1828`
(Bot DID projection). Git metadata there is broken; this is source inventory,
not verified current main or runtime. Its comment says unreadable custody yields
no identity, while `fleet-seed` catches read failure then tries generation and
an output stream. Missing/invalid existing data can therefore reach a different
path than the stated invariant. Do not reuse that fallback for enrollment or
rewrite the old source/document as part of this task.

At the design inventory, the live fleet artifact had 899 profiles, zero DID
fields and no owner binding configuration. Owner confirmed no prior enrollment.
Neither a profile ID nor a mailbox hash is a verified DID binding.

## Registration state machine

`unregistered -> enrollment-pending -> verified`

Failures after a durable namespace/subject marker become `recovery-required`;
they never return to first-use initialization. Revocation is explicit. At boot,
an existing verified subject is loaded and its proof checked; do not create a
new subject just because a process, key path or host changed.

1. Bootstrap an owner namespace through an authenticated owner ceremony and
   create its root custody only once. Reuse canonical wrapped-key/recovery
   records; never invent another cipher or transmit a fleet seed to workers.
2. Allocate a stable random principal UUID. Bind owner namespace, immutable
   agent ID/derivation-key ID, optional profile reference, DID/key epoch and
   schema version. Existing identities retain their derivation IDs and DIDs;
   display-name/profile-directory changes do not alter them.
3. Claim a namespace/agent enrollment slot using authenticated distributed CAS.
   The owner signer derives/reuses the existing per-agent key and signs the
   structured principal/DID binding. A DID self-signature proves possession;
   owner namespace authorization independently approves the association.
4. Persist the private registry encrypted in Agent-owned Kotobase/AwaiFS;
   publish only required public proofs. Acknowledge verified only after fresh
   recovery/readback against the committed head. Retries resume the same
   principal/transaction; partial commits are reconciled without new identities.
5. Project verified public bindings to the private owner service. No alias,
   decrypt/read/send grant or wallet authority follows automatically.

The signer holds custody, outside the Bot/LLM process. It accepts bounded
domain-specific registration/rotation requests, not arbitrary bytes. Do not put
seed/key material in prompts, argv, cron configuration, telemetry or a persistent
environment variable. The existing manual environment-seed CLI remains migration
inventory, not the proposed daemon custody interface. Funding keys and their
policy remain separate under AWAI-422; a node DID is not an agent signer.

## Rotation, recovery and distribution

Keep principal UUID, mailbox and private aliases stable. A replacement key has
a new did:key and higher epoch, with an authorized transition proof; did:key
itself does not rotate in place. Verify the committed latest basis and reject
stale epochs/rollback. Owner recovery is a distinct path if the old key is lost.
Missing/unreadable/invalid custody in an initialized namespace refuses startup
of identity-dependent operations until recovery, even if no local cache remains.
Two nodes racing enrollment must agree on one principal and proof via CAS;
copying a directory or synchronizing raw seeds is not distributed enrollment.

An ordinary Agent restart loads identity. Bot creation/adoption requests
enrollment under an explicit namespace policy. First-use owner key custody and
recovery require a real integration and tests before enabling this flow.

## Acceptance and UI

- Fresh create, repeat boot, rename, host move and concurrent two-node create
  preserve the same principal and allowed DID binding; partial failure resumes.
- Missing/corrupt keys, wrong namespace/proof, duplicate IDs, old epoch and
  rollback refuse; owner recovery independently restores the same subject.
- Synthetic keys stay separate from production custody. Verify permissions,
  no seed/key disclosure, key loss and independent-host recovery.
- Soshiki shows unregistered, enrollment pending, recovery required or verified.
  Detailed DID/epoch is optional disclosure; alias maps stay private.
- Verified binding connects the implemented private-mail issue/list/stop API.
  Current API requires a digest-pinned owner config plus key-possession proof.
  Its aliases remain reservations until separate SMTP/gateway qualification.

## Implementation update — AWAI-2933

Awai OS PR95 now implements the lifecycle in `bot-chat/src/itonami_identity/`:
`mail.cljc` (pure alias policy), `custody.cljc` (OS-keychain and explicit fixture
ports, encrypted seed/recovery, native export/restore), `ledger.cljc`
(authenticated namespace/agent CAS), `core.cljc` (existing D7 derivation,
structured signing, verification and encrypted registry/mail readback).
The previous `mail-aliases.mjs` domain implementation is removed. Existing MJS
is HTTP/process plumbing; browser controls remain ClojureScript.

The verified catalog is enrolled at owner-service startup and reconciled for new
profiles. A selected known Bot can resume interrupted registration. Namespace
markers and ledger fingerprints prevent lost credentials from minting another
identity. Primary recovery uses the separate Keychain recovery credential;
native ciphertext export plus a separately held owner key supports a new target.
The alias mapping and signatures are private encrypted Kotobase/AwaiFS data;
the identity master key is supplied in memory, not a database key file.

This uses the existing provider-local Otehon AES-GCM/IPLD crypto port. Canonical
hybrid envelope interoperability is not claimed. Current enrollment is epoch0;
rotation/owner re-authorization beyond recovery remains a separate transition.
An owner-approved alias-management policy is not Bot read/decrypt/send authority.

Tests include fresh creation, restart in another process, racing registration
from separate stores, missing/wrong keys, forged binding, inactive aliases,
portable owner recovery and ciphertext canaries. Real macOS Keychain and
authenticated etcd are additionally probed with synthetic identities. None of
these probes proves independent hardware durability, whole-device production
backup, arbitrary same-UID isolation, distributed alias writes or SMTP delivery.

Before live activation, recovery validation added an etcd-anchored alias-head
CAS. Pending request IDs are retained and interrupted local/head publication
reconciles the same event. Old snapshots refuse reads/updates when their head
differs from the latest authority, so recovery cannot revive stopped aliases.
Native file writes drain the complete buffer and private credential reads
require exact0600 permissions and bounded sizes. Recovery into a new store may
reuse matching existing Keychain custody, but cannot overwrite different keys.
The complete alias intent is encrypted durably before the pending claim, whose
event digest binds the chosen random address. Restart/reload can finish that
same intent even when the alias append never ran; it does not depend on browser
memory or issue a second address after an uncertain operation.
Enrollment additionally intersects each Bot ID with the owner configuration's
explicit approved list, compiled from its digest-pinned private profile
manifest. A public fleet report can trigger reconciliation but cannot authorize
another ID; a policy update is required for newly approved subjects.
