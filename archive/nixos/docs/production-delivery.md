# Production delivery

The dedicated `distribution/worker.mjs` provides read-only GET/HEAD access to
signed channel manifests and SHA256-addressed ISO/NAR exports in an R2 bucket.
It never creates trust roots or accepts uploaded commands. Node verification
is independent of TLS, a gateway or the Worker. Distribution dry-run and route,
range, HEAD, missing-object and cache tests qualify the transport source only.

The native macOS signing adapter stores Ed25519 private bytes in the login
Keychain. `init KEY_ID` refuses an existing key. `public KEY_ID` prints only the
raw public key. `sign KEY_ID` signs bounded stdin bytes without exporting private
bytes. This is software key custody under the local operator, not Secure Enclave
Ed25519 support or an independently operated quorum. Separate operator approval
and signing custody are still required for independent-authority claims.

Production activation needs: integrated source commits; explicit signing root
provisioning; successful Cloudflare authorization; uploaded complete closure;
verified published manifest/hash; owner configuration; qualified local watchdog
and rollback. Nothing named QA becomes production by changing its filename.
The current installer ships update services and public production verification
keys. It does not ship a preauthorized owner configuration. Installing it alone
does not qualify hardware recovery or activate automatic application.

The existing serial-bound KIOXIA helper validates ISO length/hash before writing,
reidentifies external media, reads back exactly the ISO length and ejects only
on a hash match. A USB write requires the configured KIOXIA to be attached; an
old disk number is never an identity.

## Current NixOS / Murakumo Client delivery, 2026-10-10

Stable sequence **5**, frozen OS source `77fb995`, is live with two verified
production signatures. Both the new ISO and complete UEFI system export were
read back in full through the public transport before manifest promotion.
KIOXIA received the same ISO and was safely ejected after a reconnect recovery.
The [current delivery evidence](nixos-client-delivery-20261010.md) records exact
hashes, media recovery, preserving update/native boot tests, replay refusal,
network QA outcomes and the remaining physical activation boundaries. Historical
sequence-4 results below do not describe this new release's verification.

To keep signing keys off the Linux builder, export with
`archive/nixos/scripts/publish-update.mjs SPEC --unsigned OUTPUT PINNED_NIXPKGS`; this writes
`manifest.pending.json`, never an unsigned channel manifest. On Mac, invoke
`archive/nixos/scripts/sign-keychain-release.mjs MANIFEST KEY_ID COMPILED_SIGNER` for each
approved signer. It verifies the returned signature against the public key
before appending it to the unchanged payload and writing atomically. Promote
only after the provisioned quorum verifies; source tests do not prove that a
production Keychain key has been created or a live file published.

## Prepared installer media, 2026-10-08

Full offline installer ISO: 5,248,696,320 bytes; SHA256
`8f671359a2fec6dcd88b5e5242531adaaabd1cf231d2ceea66e6fbe19449aed3`.
The Linux builder and Mac streaming hashes match. A dedicated no-network UEFI
VM booted this ISO to the graphical Japanese/English language selector; no disk
approval or formatting was issued. The ISO's offline system manifest identifies
UEFI `rh66qxk7wy88pavi6vnxllcranq21c1c` and BIOS
`05h4l5l146bbd4khnnh32mxdkr759fg6`. Source tests pass 86/86 and distribution
Worker dry-run succeeds. Full recovery qualification remains the preceding
committed update VM evidence; this media boot alone is not a new recovery test.

The initial preparation snapshot preceded main integration, Keychain provisioning, Cloudflare reauthorization and the completed USB write. Current production results are recorded separately below; preparation-only checks are not publication evidence.

Read-only inspection of the ISO squashfs confirms both UEFI and BIOS installed
systems contain `aiueos-update.service`, `aiueos-update-recover.service` and the
update timer. Recovery is conditioned on the durable journal, independently of
owner config availability. The unit-referenced runtime SHA256 is
`42a494666687d730d3a7005cce0c8483c77623a0ed528a7d1fb002906dd3d475`, matching
the reviewed `archive/nixos/update-linux.mjs`. The offline SCI/nbb policy runtime is
included. Unit inspection and the language-screen image are stored under
`docs/evidence/updates-20261008`. Dedicated media QA and builder VMs were
normally powered down; other user VMs were left running. Trimming only the
builder's unallocated ext4 blocks restored approximately 5.3 GiB of Mac capacity;
the generated ISO and retained build closures were preserved.

## Production publishing tools

The distribution Worker accepts channel-relative immutable archive URLs as well
as root-level URLs: the Node resolves an archive relative to `/stable/`, and
both map to the same SHA256-named R2 object. A regression test uses the actual
Node URL resolver. Cloudflare account selection is explicit in Wrangler config.

`distribution/upload-worker.mjs` is a temporary operator publishing tool, not
the read-only Node transport. Deploy it only with an exact `ALLOWED_KEYS` JSON
list and the operator Ed25519 `PUBLIC_KEY`. Each request verifies a short-lived
`aiueos.upload.v1` ticket binding operation, object, upload ID, part number,
body length and SHA256. Parts are at most 32 MiB. It has no unsigned upload or
command path. `archive/nixos/scripts/upload-release-r2.mjs` signs tickets through the approved
Keychain helper and checkpoints multipart receipts for resumption. Supply HTTPS
URL, FILE, HASH_KEY, SIGNER_BINARY, KEY_ID and CHECKPOINT arguments. Never pass
private key bytes to the Worker. After upload, verify the full object length and
SHA256 through the read-only production transport before promoting the signed
channel manifest, and delete the temporary publishing Worker.

The real `aiueos-6600hs-2` at `100.84.134.120` was checked over Tailscale SSH on
2026-10-08: Ubuntu 24.04.4, UEFI, no AiueOS update timer and no `/dev/watchdog0`.
The AiueOS provider must not be installed/enabled there as an Ubuntu replacement.
Physical automatic activation awaits the actual installed NixOS target and
qualified watchdog/fallback evidence; an online hostname alone is insufficient.

## Historical production release and activation boundaries, 2026-10-08

The production transport is `https://aiueos-updates.04-feasts-minded.workers.dev`,
with the private R2 bucket `aiueos-releases`. Production keys
`aiueos-production-release-20261008` and `aiueos-production-owner-20261008` are
held in the same operator's Mac login Keychain. Two verified signatures meet the
configured threshold; they do not constitute independent signing authorities.
The OS source is frozen at installer main `efb39056e3b3abc5b5673b9ec5d55a19b5c3dc20`
and Grant main `2e0496249fb969b52cf3bdbbc1d8b0238c7ac559`. Subsequent main changes
fix distribution paths, authenticated multipart publishing and full HTTP status,
without changing the USB OS runtime.

Sequence 4 is a new production-signed full system closure (not a QA fixture),
7,488,473,952 bytes, SHA256
`60530f0ffcbb8b4f6ecaecdb82e876b9dd3a558e0c06a4081fa2e7152bd8df60`.
The updater independently admits both signatures, channel, architecture,
`uuid-v1` host contract, expiry and monotonic sequence. Archive verification
must complete before `/stable/manifest.json` promotion. Evidence receipts below
are authoritative for whether promotion and full public readback completed.

The networked production QA uses a new copy-on-write overlay of the previously
qualified update VM. It leaves the original QA disk and other user VMs untouched.
A virtual NIC changed the EFI device path, so the existing systemd bootloader was
launched from the EFI shell; this is not a fresh automatic EFI boot qualification.
Its existing timer is enabled and active. The final reviewed runtime is supplied
by a `/run/systemd/system` service override in this QA clone; that override is
transient and is not a deployed physical-node OS generation. Production public
keys/configuration are installed only in this test clone. Owner authorization
and watchdog qualification there are test evidence, not a real account claim.
No offline-time exception, apply-now override or shortened grace is used.

Physical activation requires the actual installed NixOS target, owner policy,
qualified recovery and adequate space. That historical installer included the
update units but shipped without production owner config/trust roots. An enabled
unit without this configuration does not establish active automatic updating.
The normal stable policy polls every 15 minutes with up to two minutes of jitter,
uses the 03:00-05:00 local maintenance window, and keeps a previous boot generation.
High security risk has a 72-hour grace and critical risk a 24-hour grace, followed
by refusal of new jobs/draining; high application risk still needs review. These
deadlines never override signature, capacity or recovery checks. Fleet activation
remains unavailable until real scheduler leases and drain integration qualify.

The [production receipt](evidence/production-updates-20261008/delivery-status-20261008.json)
records completed full public readback of both artifacts, stable sequence 4
publication, two valid signatures and tamper refusal. The temporary upload Worker
was deleted: its endpoint returns 404; the manifest returns 200 and transport
mutation returns 405. All 90 source tests passed with the pinned Grant checkout.

The QA VM fetched the actual public manifest and admitted sequence 4 using both
production public keys. The timer was enabled/active with the next check scheduled.
The provider recorded `hold: insufficient staging space`, exited nonzero without
import or reboot, and persisted the notification/high-water sequence 4 while
retaining installed sequence 2 and prior block history. Its 10,871,119,872 free
bytes were below the 22,465,421,856 staging requirement. This verifies refusal,
not a completed installation or trial of the new production closure. The QA VM
was normally powered down after evidence capture. Physical automatic updating
remains disabled pending the installed NixOS target; the Ubuntu machine was
only inspected. The verified/ejected KIOXIA media from the preceding delivery
is unchanged and already contains the final reviewed updater.
