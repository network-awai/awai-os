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
