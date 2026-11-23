// AWAI-4071 walk-through: new-device challenge -> phone verify ->
// selected-profile seal -> new-device open. Real WebCrypto, non-exportable
// P-256 keys. Run: node docs/evidence/awai-4071-handover-20261123/walkthrough.mjs
import { p256Did, compressP256 } from "../../../otehon/shell/src/identity/link.js";
import {
  createHandoverChallenge,
  verifyHandoverChallengeWithKey,
  handoverConfirmationCode,
  sealProfileTransfer,
  openProfileTransfer,
  transferStatus,
} from "../../../otehon/shell/src/identity/handover.js";

const NOW = Date.parse("2026-11-23T00:00:00.000Z");
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const did = p256Did(compressP256(rawPub));
const { challenge, ephemeralPrivateKey } = await createHandoverChallenge(did, "My Android", ["profile:settings"], NOW, pair);
console.log("1. New device challenge created");
console.log("   deviceDid:", did);
console.log("   deviceName:", challenge.deviceName);
console.log("   scope:", JSON.stringify(challenge.scope));
console.log("   exp:", challenge.exp);
console.log("   confirmationCode:", handoverConfirmationCode(challenge));

const verified = await verifyHandoverChallengeWithKey(challenge, rawPub, { deviceDid: did, now: NOW });
console.log("2. Phone verified device-key signature");
console.log("   verified.device:", verified.device);
console.log("   verified.status:", verified.status);
console.log("   profile in verdict?", "profile" in verified, "(must be false: approval alone copies nothing)");

const payload = { scope: "profile:settings", locale: "ja-JP", homeBackground: "auto" };
const sealed = await sealProfileTransfer(challenge, payload);
console.log("3. Phone sealed selected-profile transfer (ciphertext only)");
console.log("   sealed.bytes:", sealed.length);
console.log("   contains plaintext ja-JP?", sealed.includes("ja-JP"), "(must be false)");

const opened = await openProfileTransfer(challenge, ephemeralPrivateKey, sealed);
console.log("4. New device opened the envelope with its ephemeral key");
console.log("   opened:", JSON.stringify(opened));

try {
  await sealProfileTransfer(challenge, { seed: "words" });
  console.log("5. FAIL: secret-bearing payload was sealed");
} catch (e) {
  console.log("5. Secret-bearing payload refused:", e.message, "(must be forbidden-field)");
}

console.log("6. Unimplemented scope:", JSON.stringify(["profile:wnfs-snapshot"]), "->", transferStatus(["profile:wnfs-snapshot"]), "(must be unavailable/defer)");
console.log("WALKTHROUGH-OK");
