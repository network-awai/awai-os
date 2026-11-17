# NixOS signed update operations

## Runtime and scope

Installed UEFI NixOS includes an update timer (15 minutes plus jitter) and an
on-boot recovery service. Updates run only after a private owner configuration and anti-replay journal are
provisioned. Recovery uses the retained journal even if configuration is missing. No release verification root is invented or
shipped as a trusted production key. BIOS machines and non-NixOS systems are
not automatically activated. An unqualified/missing watchdog holds activation.

This implementation supports **standalone Nodes**. A fleet worker is explicitly
refused until a current-owner coordinator/lease and measured job-drain adapter
is connected; a local lock cannot pretend to be a fleet-wide lease. This is a
runtime refusal, not a simulated successful fleet drain. The local persisted
admission gate is available to workers but an external scheduler must consume it.

The shared Kotoba `.cljk` policy is packaged with a pinned offline SCI runtime.
No npm, Maven, git checkout or online source build happens on an installed Node.
The vendored runtime is EPL-1.0; its import resolver is MIT. Rebuild with
`archive/nixos/scripts/build-update-policy.mjs GRANT_CHECKOUT NBB_CHECKOUT`; provenance records
the pinned runtime revision and policy source SHA256. No hand translation into
another language is the decision authority.

## Owner provisioning

Prepare private JSON (`0600`, root-owned on the Node):

```json
{
 "schema":"aiueos.update-config.v1",
 "enabled":true,
 "ownerPolicyAuthorized":true,
 "role":"standalone",
 "initialSequence":1,
 "sources":["https://OWNER-MIRROR/aiueos/stable/","file:///media/SIGNED-USB/updates/"],
 "trust":{"threshold":2,"channel":"stable","keys":{"release-1":"ED25519 PUBLIC PEM","release-2":"ED25519 PUBLIC PEM"}},
 "policy":{"mode":"automatic-stable","channel":"stable","semi-mandatory?":true,"high-grace-ms":259200000,"critical-grace-ms":86400000,"max-apply-risk":"medium"},
 "watchdogQualified":true,
 "healthServices":["NetworkManager.service"]
}
```

`watchdogQualified` is an operator record of real watchdog/fallback qualification,
not a way to manufacture a device: activation also checks `/dev/watchdog0`, UEFI,
installed bootloader and the current host's two filesystem UUID parameters.
Only set it after a real reboot/fallback test. Add required long-running Node
services to `healthServices`; do not include a completed oneshot setup wizard. Missing config is shown as updates
not configured. A downloaded manifest cannot grant owner policy authorization.

Run `archive/nixos/scripts/provision-updates.mjs CONFIG` as root on the installed NixOS. It
refuses an existing journal/config; journal is written before enabled config.
Deleting a journal does not start from sequence zero: the updater stops. Journal
and config are outside the Nix store. Owner changes are root-authorized local
operations; this version has no account-authenticated remote policy editor.
`applyNow` is a standing immediate-application policy until cleared, `deferUntil` postpones within the
security grace. `offlineTimeAuthorized` is an explicit offline trust choice;
otherwise NTP synchronization is required. None is accepted from release data.

## Publish and distribute

On the qualified Linux build host, prepare a release spec with `arch`, `channel`,
`sequence`, `issuedAt`, `expiresAt`, `securityRisk`, `applyRisk`, `systemPath`,
`hostContract:"uuid-v1"` and `keyId`. Run
`archive/nixos/scripts/publish-update.mjs SPEC PRIVATE_ED25519_KEY OUTPUT_DIRECTORY PINNED_NIXPKGS`.
It queries/exports the complete Nix closure, computes streaming SHA256 and length,
then signs exact manifest bytes. Keep the private key off Nodes and mirrors.
Use `archive/nixos/scripts/sign-update.mjs MANIFEST PRIVATE_ED25519_KEY KEY_ID` to append a
second signature atomically. Quorum policies require independent publishers to add distinct signatures over
the exact same payload; duplicate signers never count twice. A single-signature
publication cannot satisfy a two-key trust policy.

Serve immutable `SHA256.nar-export` and atomic `manifest.json` via
`archive/nixos/scripts/serve-updates.mjs OUTPUT_DIRECTORY`. Default binds loopback. Public bind
requires `AIUEOS_TLS_KEY` and `AIUEOS_TLS_CERT`; it accepts read-only GET/HEAD,
never uploaded commands. The same files can be copied to removable media, HTTPS
mirrors or content-addressed gateways listed by the owner. Gateways provide
transport; they do not become release authorities. Production DNS, TLS, release
signing authority and promotion are not provisioned by these tools.

## Apply and recover

The service is serialized by `flock`, persists first notice and high-water mark,
streams/hash-checks archives before import, verifies every closure store path,
checks space, pins staged/prior generations, preserves root/ESP UUIDs, installs
a retained fallback and requests **one-shot** trial boot. The previous entry is
the default until local health passes. Runtime watchdog and `panic=30` support
bounded reboot on supported machines. No partition/format operation exists.

After boot, recovery compares `/run/current-system` to the journal, checks the
required local services, and commits the system profile/default only for the
expected healthy generation. Failed trial restores default/clears one-shot and
reboots; the previous boot clears pending and records the failed digest. Failed
sequence remains below the durable admitted high-water mark and is not silently
replayed as another signed artifact at that sequence. Internet/account outages
alone do not fail local health. Configured local services do.

Semi-mandatory deadline behavior uses the same safety checks: stop new work via
`admission.json`, drain, then trial when safe. High application risk stays a
manual-review outcome. If verification/recovery is missing, retain current OS,
show a blocked reason and never format/reinstall to “fix” an update.

`status.json` supplies a redacted Node details view. Journals, raw HTTP errors and
private configs are not shown as Wi-Fi/account secrets. Stop/delete is not an
API operation. Keep healthy roots pinned; this version does not automatically GC
old generations or delete Wi-Fi, identity, account receipts or user data.
