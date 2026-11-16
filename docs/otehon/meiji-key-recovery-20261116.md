# Meiji key recovery — AWAI-2820

Owner authorized replacement of unrecoverable keys and encrypted AwaiVol
persistence on 2026-11-16. Retain the existing etcd cluster
`15997540139816619698`, member identities and job cursors. The initial read
found three healthy members at revision 3024 and no data reset is required.

`meiji.recovery` provides AES-256-GCM authenticated envelopes, random 96-bit
nonces and a context binding checked before decrypting. Its wrapping key is
created once in macOS Keychain (`network.awai.meiji.recovery.v1`); secret bytes
enter Keychain only through private stdin, never command arguments/environment.
AwaiVol receives only the envelope. Recovery still requires access to that
Keychain; an AwaiVol backup is not a backup of its wrapping key.

Initial tests: 14 tests / 115 assertions pass, including ciphertext/context
tampering, wrong wrapping key, fresh nonce and absence of plaintext in the
envelope. This does not yet prove production credential backup/restoration.

At 08:09 UTC, replacement CA/root-client/fixed-command operator credentials
were generated in the private managed application directory. The encrypted
AwaiVol record `/.itonami/recovery/keys/awai-2820-20261116-v1.json` was fetched,
authenticated/decrypted through the Keychain wrapping key, and all six original
files matched. Ciphertext SHA-256:
`9fde4a2983b54f44e92f7e81efcf22a2c631decf6c37379d6cab7668ec01c93c`.
No plaintext credential was uploaded or committed. Independent remote replica
or loss-of-Keychain recovery is not claimed. A new recovery CLI stages the
client trust bundle, checks all three original cluster IDs/leaders and requires
a matching prepared bundle before restarting the explicitly owned member.
Suite after this change: 15 tests / 118 assertions pass.

Planned live sequence: generate new recovery CA/root client and fixed-command
SSH operator credentials in the managed private application directory; encrypt,
upload, fetch/decrypt and compare the backup; preserve the old CA and add the
new recovery client CA on one member at a time, verifying quorum, original
cluster ID and cursor data after each restart. Peer/server certificates and
membership remain unchanged. The root client's certificate Common Name maps
to the existing etcd root user; authentication is never disabled.

New root issuance does not revoke the lost root certificate while its original
CA is retained for live node clients. Old credential revocation and any broader
CA retirement require separate evidence of all affected client replacements.
Source: [etcd 3.6 transport security](https://etcd.io/docs/v3.6/op-guide/security/).

At 08:17 UTC the additive client trust update completed on benjamin, levi,
then joseph. Each restart was followed by three-member status verification
using the original node credential. The replacement root client can read the
existing root role and all three endpoints, and the original cluster ID is
unchanged. All five public VM enrollment/cursor projections match the pre-update
audit. No enrollment/cursor/data-directory or peer/server key was changed.

A 6684704-byte pre-migration etcd snapshot was taken through the recovered
admin connection. Ten credential/config/snapshot files were authenticated,
encrypted and roundtrip verified in AwaiVol v2 backup:
`/.itonami/recovery/keys/awai-2820-20261116-v2.json`, ciphertext SHA-256
`3e39e8da879669768f33abcb64e2cfd8d66800a89ad3cdd8033f009535f1e716`.
The snapshot SHA-256 is
`c808d98f58151e7207a17327350aa828103c9a645b7609a047b2bf1cc62e02fb`.
This proves fetch/decryption/byte equality; it does not prove disaster recovery
without the wrapping Keychain or independent backing-tier replica availability.

The new SSH operator key is prepared but not yet accepted by the old guest
image, which embeds the lost operator public key. The next Meiji image must
read the replacement public key from its owner-controlled key disk, import
existing guest Pack/results from a read-only history disk, then verify original
result recovery before admitting further work. Old guest disks remain intact.

## Production readback after migration

The follow-up image 0.2.0 now boots on both existing physical owners. Its
strict boot index selects the new system disk; old guest disks remain
read-only and their hashes match the stopped originals. History import
completed on both nodes. Runtime authorized-key files are numeric root-owned;
OpenSSH StrictModes and pinned original guest host keys remain enabled.

Both original completed results were exported from both new guests and matched
the original CAR SHA and owning Linear records, without recomputation. After
restoring all five unchanged enrollments, the next due original slots produced
new results for AWAI-2421 (16/16 probes) and AWAI-2422 (15/15). Both results have
two VM replicas, exact AwaiFS readback and confirmed owning Linear comments.
They are bounded Otehon physics simulations, provider none/model deterministic;
they do not prove Native tests, code growth, mail or GPU inference.

`meiji.coordinator` wakes on the owner control machine; the existing ledger
schedule determines the original daily JST phase and computation happens in
the enrolled guests. The owner machine remains a scheduling dependency. A
read-only recorder certificate can read the occurrence prefix but cannot write
to etcd; guest identities own admissions and result writes. An OS file lock
prevents overlapping owner processes. Public observation is persisted/read
back at `/.itonami/runtime/meiji-current.json`, then shown in Tauri's 本番 view.
Observations older than three minutes are explicitly stale. No fleet-wide
899-Bot liveness claim follows from these two completed jobs.

The scoped recorder's key, certificate and configuration were added to the
encrypted v4 recovery envelope (16 files). Exact decrypt/readback matched.
Loss of the wrapping Keychain and independent remote-tier recovery remain
unqualified. Old CA trust has not been revoked; existing node clients still
depend on it.

## Separate jacob result review

`meiji.result-review` consumes only the two confirmed public physics results;
it does not modify their grants or claim the physics Bots use inference.
The owner-selected Kapitsa worker on jacob returned a real result in 27,681 ms:
Qwen3.6-35B-A3B `16gb`, prompt 409 / completion 512 / total 921 provider tokens.
Cached tokens were 0 within the prompt counter for this one call. Reasoning
tokens and GPU utilization were not reported. Coding-session usage remains
unknown/unallocated. The result and raw usage are persisted on AwaiVol and
recorded on AWAI-2820 under the explicit review input digest.

The 512-token response ends at the analysis heading. It is a draft, not a
finished analysis acceptance unit. Tauri 本番 displays it with a 下書き badge;
モデル・使用量 expands to the actual model and 409/512 counters. Future new
input sets request three short bullets and retain terminal finish reason;
the existing input is not reinferred to improve its truncated answer.

The review identity has a separate single-key CAS namespace and cannot write
occurrences. An initial controller error was proven to precede tunnel/HTTP
dispatch. Recovery retained the original claim/owner and consumed a specific
operator-evidence marker by CAS before one invocation. Generic unknown HTTP
outcomes never retry. The canonical occurrence transport's allowed key scope
was kept unchanged. Tests cover scope rejection, uncertain admission, lost
terminal, completed reuse and one-time pre-HTTP recovery.

Encrypted recovery v6 additionally includes active coordinator/reviewer config,
the recovery receipt and delegated jacob API credential (23 files total).
No plaintext key or token is stored in WebDAV or Git.

The post-migration live dedup check submitted each completed slot to both VM
owners: all four responses were `already-completed`, `invoked false`; both
cursors were unchanged. The separate reviewer wake reuses the same completed
review, rather than adding the repeated log's counters to cumulative usage.

During follow-up, localhost WebDAV and its stats endpoint timed out. Manifest
and the empty durable journal were preserved privately before a controlled
daemon SIGTERM/restart by launchd. New PID 54004 served again; encrypted v6 was
fetched/decrypted again with all 23 files equal, and the old review was read
back without inference. Background-tier sync was initially pending after boot;
this is not a storage SLO or independent replica qualification. The reviewer
now distinguishes unavailable storage from an artifact conflict. On recovery,
semantic equality handles reordered maps while exact original JSON bytes stay
immutable. Reviewer tests: 7 tests / 19 assertions, including no overwrite on
changed contents or unavailable storage.
