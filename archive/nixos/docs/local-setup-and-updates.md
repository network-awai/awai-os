# Awai Node setup, account linking, language and NixOS updates

## Current implementation

The current OS is **NixOS**. **Murakumo Client** is the software suite;
**Awai Node** is a participating instance or host. **AiueOS** is a future
replacement OS and remains incomplete. This installer contains an offline,
prebuilt NixOS system. See [naming and compatibility](product-naming.md). The
installed system now includes a signed-release timer and boot recovery service.
They run only after a local owner provisions private update configuration and
trusted verification keys. No production keys or update source are shipped.
Changing source or flashing a USB does not update an already-installed PC.
See [update operations](update-operations.md) for provisioning and current limits.

At startup the graphical installer and installed setup guide offer Japanese and
English. The preferred language is saved privately in `/var/lib/murakumo/ui-language`,
copied into the installation, and offered first on subsequent boots. The choice
sets both controller text and graphical headings/buttons. Console fallback uses
an equivalent language menu. Language selection never authorizes a disk erase.

Installed setup begins with an explicit use choice:

1. **Complete setup on this device** creates or reuses its Ed25519 device identity
   and X25519 encryption key, writes a private local completion record, and shows
   its public `did:key`. It performs no HTTP request and creates no account receipt.
2. **Link a Murakumo account** opens connection settings, then the existing bound
   approval protocol. A phone can scan the QR; another computer can open the
   displayed approval URL. Both still require the published account service and
   a supported authenticated Passkey session.
3. **Wi-Fi / Ethernet settings** configures the network without starting a claim.

Local completion survives reboot. Network settings and later account linking remain
available. Private keys are not displayed or exported. Unreadable or mismatched
saved state stops replacement enrollment. An account-link failure preserves the
OS, network profiles and device identity and offers local completion. Local completion
is not proof of inference readiness, public job admission, settlement or a serving
process: those components are not supplied by this installer configuration.

## Current public account-link blocker

On 2026-10-06, an empty, non-enrolling POST to
`https://murakumo.cloud/api/devices/link/start` returned HTTP 404 with
`{"error":"unknown devices route"}`. The client currently pins this authority.
The error is before QR generation; reinstalling or changing Wi-Fi/phone settings
cannot publish the missing route. The client now identifies this specific failure.

A production handoff must integrate and publish the reviewed start/poll/status
routes and authenticated approval UI together, including authorization/receipt
binding, expiry, refusal, cancellation and revocation checks, then verify a real
Passkey account linking ceremony. Local fixture approval is not that proof. No
production deployment is performed by this change.

## Proposed decentralized workflow (not an implemented peer stack)

Local identity and setup completion are independent of a centralized account.
Keep local services usable without account registration. A subsequent **Join a
network** flow should accept an operator-signed invitation by file/USB or a typed
content address, display network identity and permissions, and require a local
choice to trust it. Never auto-claim ownership from an unauthenticated LAN peer.

The invitation binds the device DID, network trust roots, authorized roles,
expiry and replay nonce. Peer discovery may use configured peers, local discovery
and content-addressed documents; transport reachability confers no admission.
Validate signatures and device binding, persist admission separately from local
setup and cloud accounts, then establish encrypted peer channels. Show discovery,
trust, admission and execution readiness as separate observable states. Offline
setup remains complete when all peers are unavailable. None of peer discovery,
invitation admission, model execution or rewards is newly implemented here.

## Integrated OS updates (owner provisioning required)

See [the update lifecycle](os-update-lifecycle.md) for distribution, signed
verification, durable staging, automatic scheduling, deadline-bound
semi-mandatory updates and boot recovery. The shared Kotoba decision library and
Linux controller have executable tests. The Nix configuration includes conditional
update/recovery services and the offline policy runtime. Standalone UEFI VM boot
qualification is recorded in [verification](verification-updates-20261008.md).
Production signing, fleet enforcement and physical hardware qualification remain gates.
