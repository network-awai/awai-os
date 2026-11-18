# Awai key approval client v1 (ADR 0048)

An app asks the Awai app (`network.awai.app`) to use a key; it never holds one. `client.js` exports `createApprovalClient({invoke})` with:

- `botWalletAddress(walletId='default')`: the address of this app's Bot wallet. The Awai app creates the wallet on first use, after its card and the user's authentication.
- `signBotLaunch({walletId, assignmentId, businessId, creditLimitMicros, walletAddress})`: returns `{wallet_address, wallet_signature}`. The Awai app builds the bot worker's `walletLaunchMessage` from these fields itself, shows that exact text on its card, and signs it only after the user approves and authenticates.

The Tauri host exposes only `awai_key_approval` through `android/network/awai/approval/ApprovalClientPlugin.kt`. The plugin passes one typed request to `network.awai.app/.ApprovalRequestActivity` by an explicit Intent and checks the result's schema, request ID and value shapes.

Android consumers need:

- `<uses-permission android:name="network.awai.permission.KEY_APPROVAL"/>`;
- package visibility for `network.awai.app`;
- the shared Android source directory;
- a scoped Tauri command and capability.

The Awai app checks the caller's package against its allowlist for the kind, and requires the same signing certificate. A caller must be added to `ApprovalRequest.callers` in `network-awai/awai-mobile`. A permission alone does not approve anything.

There is no fallback. If the Awai app is missing, or its permission is not signature-protected by a matching certificate, the client rejects with `key-approval-unavailable`. A denial, a failed authentication or a closed card rejects with the Awai app's error code. Nothing else signs instead.

Consumers vendor these files unchanged and pin their SHA-256, as with `packages/awai-inference`.
