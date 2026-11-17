# Physical owner authentication and native inference — 2026-11-17

JUN-1339 continues JUN-1337 UI/device qualification.

## Verified direct Murakumo generation

On the physical AMD Ryzen7 7735HS/API37 x86_64 Desktop, the existing639446688-byte Qwen3-0.6B-Q8_0.gguf was independently hashed on-device and matched the immutable pin9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031. Actual Android touch pressed Load, then entered the non-private prompt `Say hello in one short sentence.` and pressed Generate. The application returned `Hello! How can I assist you today?`, engine `llama.cpp`,9 output tokens and the actual completed UI state.

[Receipt](evidence/jun-1339/direct-generation.json) and [actual physical screen](evidence/jun-1339/direct-generation.png). Host tap-to-observed-load1061ms and tap-to-observed-generation549ms include UI/polling overhead; this one request is not a throughput benchmark or broader model-quality qualification. No new download, remote model call, fixture, signing/session injection or direct native invoke was used. The existing model is left loaded for the subsequent Itonami handoff.

## Unattended authentication and Itonami handoff

Owner's existing AWAI-3030 instruction is to keep personal signature/relay choices out of the debug critical path. The initial owner-consent request in this chat was withdrawn. The unchanged production verifier is exercised with fresh host-created software wallet/passkey signatures in separate test-only QA packages; this does not enroll the owner's account.

Derived current shared-UI x86_64 QA apps have separate IDs (`network.itonami.app.qa`, `network.awai.murakumo.qa`), the existing dedicated QA signer, separate local-inference permission/provider authority, a QA-only caller allowlist, no INTERNET permission and no production inference grant. Actual manifests, signatures, source trees and old AWAI-3030 ownership markers were checked before updating with `install -r -t`. No app data was cleared and no OS reboot occurred. Normal app processes were quiesced for file-hash comparison.

The final physical run passed18 checks in one sequence: invalid signature/wrong device/expired proof/wrong passkey origin/missing verification refused; fresh wallet and passkey signatures accepted; authenticated Core and app force-stop retention observed; existing QA model bytes/digest admitted and loaded; Itonami Core→Murakumo native confirmation denied with no output, then allowed with actual34-byte output `Hello! How can I assist you today?`; model release; proof removal blocks access despite completed setup; normal app non-cache file hashes and platform provisioning/boot identity unchanged. The prior completed QA setup was reused; fresh Finish and physical reboot are not claimed in this run.

[Sanitized QA receipt](evidence/jun-1339/isolated-qa.json), [authenticated Core](evidence/jun-1339/authenticated-core.png), [Itonami→Murakumo result](evidence/jun-1339/app-to-app-generation.png). Screens carry an explicit test-account watermark and were inspected before publication. The final actual Core is left visible with a fresh isolated software test proof; it is not the real owner's profile. QA provider memory was released after testing.

The first QA run already returned the actual text but failed the host oracle's status lookup: status is in the model column, not the generation column. The selector was corrected, historical failures preserved, and the entire final sequence rerun successfully. Private one-shot driver/source/manifest/raw remain task evidence, not an app runtime or CI dependency. Six existing QA scope guards also passed.

Authentication now exposes Core chrome beyond the earlier Sign In inspection. Narrow bottom dock labels/contrast are visibly degraded by shared control decoration; [JUN-1340](https://linear.app/kotobalabs/issue/JUN-1340) records the concrete follow-up. Functional authentication/inference success does not qualify the full visual surface. Model-picker cancellation UX remains JUN-1338.

Owner hardware passkey/wallet/phone enrollment, external relay/network, general model quality, physical reboot/ROM/OTA and the unconnected Manimani service are not covered by this QA run. No owner credential, real proof, request topic or key is published.
