# Physical owner authentication and native inference — 2026-11-17

JUN-1339 continues JUN-1337 UI/device qualification.

## Verified direct Murakumo generation

On the physical AMD Ryzen7 7735HS/API37 x86_64 Desktop, the existing639446688-byte Qwen3-0.6B-Q8_0.gguf was independently hashed on-device and matched the immutable pin9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031. Actual Android touch pressed Load, then entered the non-private prompt `Say hello in one short sentence.` and pressed Generate. The application returned `Hello! How can I assist you today?`, engine `llama.cpp`,9 output tokens and the actual completed UI state.

[Receipt](evidence/jun-1339/direct-generation.json) and [actual physical screen](evidence/jun-1339/direct-generation.png). Host tap-to-observed-load1061ms and tap-to-observed-generation549ms include UI/polling overhead; this one request is not a throughput benchmark or broader model-quality qualification. No new download, remote model call, fixture, signing/session injection or direct native invoke was used. The existing model is left loaded for the subsequent Itonami handoff.

## Owner authentication pending

The regular Itonami Sign In→Link with Phone action displays the canonical one-operation consent for service `awai-relay`, endpoint `https://relay.awai.network`, operation `await-phone-approval`, data category `link-topic`. This direct user decision is pending on the physical screen; the agent has not approved it. The subsequent QR/phone wallet or passkey ceremony must be completed by the owner. No request topic, QR, account/session proof or private signer data is published here.

Direct Murakumo generation does not establish Itonami account authentication or the Itonami→Murakumo request/confirmation/result path. Those acceptance gates remain open until actual owner consent, cryptographic verification and the normal UI handoff are observed. QA test-only applications and software-wallet fixtures from other tasks are not substitutes.
