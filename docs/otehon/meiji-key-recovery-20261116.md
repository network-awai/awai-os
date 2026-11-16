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
