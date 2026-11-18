# Awai OS account proofs for WNFS

Awai Home keeps the existing Passkey link and the non-exportable P-256 device key of the current Android user. The WNFS broker reuses that link to issue short-lived signed statements. No new Passkey, root account, relay endpoint or app-origin API is introduced.

Drive and Itonami call the explicit AccountBrokerActivity using Android activity results. The broker admits the exact package name and matching distribution signer, checks the device lock state, and obtains a new native confirmation for a particular fingerprint or sharing recipient. Its local-only WebView uses the same profile and origin as Home. An absent, expired or wallet-only link returns no statement. The statement contains the public device key and existing public link proof. The private device key stays in Home.

The verifier walks the account-to-device and device-to-statement signatures, checks the action, app, identity and expiry, and rejects key or payload substitution. Account identifiers are Awai Passkey-derived DIDs. A verified proof authenticates the specific DID; callers compare the intended person's DID through an already trusted channel. The broker does not attest that a remote key was hardware generated. An account link is scoped to the current Android profile.

The supported callers currently share Home's distribution signer. The published signer set and rotation for separately signed apps require independent release qualification. Fixture signatures do not count as live Passkey enrollment.
