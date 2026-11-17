# AWAI-3014 — bounded encrypted Drive snapshots

Drive's shared CLJC adapter consumes the exact pinned Kotoba hybrid envelope,
keystore and org-signal primitives and owning AwaiFS CAR codec in `vendor/PINS.json`.
It produces owner-store `object-v2` raw frames and an encrypted
`private-manifest-v1`, carried as SHA256/raw CIDv1 blocks in CARv1. Private file
names, directory paths, hashes, metadata and content are encrypted. Public
recipient keys, opaque IDs, ciphertext lengths/counts and traffic remain visible.
It is not a new cipher, canonical-file schema or WNFS private-tree implementation.

The pinned async `seal-object` convenience function calls classical `wrap-for`;
Drive instead explicitly composes canonical `seal-chunk`, `wrap-for-hybrid`,
`put-recipient` and hybrid `unwrap-with`. Classical/unknown entry KEMs refuse.
The source pin is unchanged. The browser-generated CAR has also been decrypted
by the separately executed existing owner-store CLI, with exact source bytes.

## Device custody and cache safety

An explicit first sync creates a device-local hybrid recipient. This is NOT an
Awai account enrollment, Passkey or imported owner identity. A random 32-byte
unlock secret and canonical wrapped key record are protected by non-exportable
Android Keystore AES-GCM, with fixed AAD, in app-private `noBackupFilesDir`.
The app WebView receives the unlock only in memory to use canonical primitives;
it is not sent to storage, argv, telemetry or logs. VM success does not prove
hardware-backed custody, user-presence protection or physical FBE qualification.
**Uninstall/clear-data/device-key loss can make remote snapshots unreadable.**
Independent recovery-key export/owner enrollment is not implemented here.

The trusted encrypted root, pack digest, endpoint and exact inventory are kept
in this device-protected control record, outside the evictable file cache.
A missing control file with an existing keystore alias refuses initialization;
there is no automatic new-identity fallback in an initialized namespace.

An upload is synced only after receipt AND a separately approved full GET/SHA
readback, followed by revalidation of current local paths/sizes/SHA. A changed
endpoint requires a new sync; it cannot silently adopt an old endpoint's receipt.
Before eviction, the native adapter rechecks every entry and refuses new/changed
files, directories, or interrupted `.pending-*` data. It never removes unsynced
source data. The internal empty writer-lock file is the only transient exception.
All cooperating file writes and vault operations use the same worker queue;
this is not distributed writer fencing.

Restore requires the locally pinned pack/root, endpoint, existing key record and
working device custody. It verifies pack SHA, CAR roots, block CIDs, owner/KEM,
AEAD, private manifest, file bounds and hashes before starting plaintext staging.
Native publication rechecks the protected receipt and all staged files. Existing
files are not overwritten. Unknown/missing/corrupt/partial data refuse; there is
no old-root fallback. Staging writes have aggregate/entry/reserve admission.

## Supported bounds

This first browser snapshot adapter admits **8 MiB total**, at most 1000 native
entries, depth16, 65531-byte raw frames, CAR<=12 MiB/4096 blocks. It restores only
raw frame codec0; compressed legacy snapshots refuse rather than guessing.
Ordinary local import still admits up to1 GiB, but files beyond the snapshot
bound remain local/unsynced and cannot be evicted. These are resource bounds,
not approved performance thresholds. Large streamed encrypted trees, WNFS,
sharing/revocation, independent nodes, latest-head/fencing, repair/GC, owner/phone
recovery and physical power loss retain their separate acceptance gates.

## Configured HTTPS storage protocol

Build with `AWAI_DRIVE_SYNC_ORIGIN=https://storage.example npm run build`.
Only an exact HTTPS origin is accepted. The build derives static CSP and the
canonical descriptor from that origin. Default builds have no endpoint, no
remote operations and hide sync/restore/eviction controls. No app-origin proxy
or native HTTP bypass exists. The origin hosts static app assets only.

The browser connects directly through the exact digest-pinned canonical broker.
Each operation requires fresh trusted input showing endpoint, method/path and
data categories. Denial sends no request. Upload is PUT, download/readback GET,
to `/awai-drive/v1/packs/<64-lowercase-hex-sha256>`, with no queries, credentials
or redirects. PUT sends bounded CAR bytes and requires a JSON receipt
`{sha256, bytes}`. GET sends only the opaque pack ID and returns the same bytes.
The immutable storage service must implement access control, durable publication,
resource limits and CORS for the admitted app origin; this repo does not deploy a
production service. A readback is not independent-node retention evidence.

`test/pack-server.mjs` is a loopback-only synthetic HTTPS VM fixture, not that
production service. Its TLS key, custom CA, debug-only Android trust overlay,
user data and logs are task evidence, never committed into a shipping trust store.
Do not install a VM-fixture APK on a physical device. Default/system CAs apply to
normal release builds. The original Nix/EFI and all physical devices stay intact.

Figma sync/recovery proposal (baseline preserved):
https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=259-1506
