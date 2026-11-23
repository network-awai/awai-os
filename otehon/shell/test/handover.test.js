// AWAI-4071: account handover protocol — challenge binding, device-key
// possession, encrypted selected-profile transfer, and the guarantees that
// QR/Passkey approval does not itself copy a profile or a credential.
import assert from "node:assert/strict";
import { test } from "node:test";
import { p256Did, compressP256 } from "../src/identity/link.js";
import {
  HANDOVER_SCHEMA,
  HANDOVER_TTL_MS,
  createHandoverChallenge,
  verifyHandoverChallenge,
  verifyHandoverChallengeWithKey,
  handoverConfirmationCode,
  sealProfileTransfer,
  openProfileTransfer,
  transferStatus,
  hasForbiddenKey,
  validChallenge,
} from "../src/identity/handover.js";

const NOW = Date.parse("2026-11-23T00:00:00.000Z");

async function devicePair() {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function didOf(pair) {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { did: p256Did(compressP256(raw)), raw };
}

test("challenge binds device pubkey, device name, expiry and profile scope", async () => {
  const pair = await devicePair();
  const { did: realDid, raw: rawPub } = await didOf(pair);
  const { challenge } = await createHandoverChallenge(realDid, "My Android", ["profile:settings", "profile:home-state"], NOW, pair);
  assert.equal(challenge.schema, HANDOVER_SCHEMA);
  assert.equal(challenge.device, realDid);
  assert.equal(challenge.deviceName, "My Android");
  assert.deepEqual(challenge.scope, ["profile:home-state", "profile:settings"]);
  assert.equal(Date.parse(challenge.exp), NOW + HANDOVER_TTL_MS);
  assert.ok(validChallenge(challenge));

  // Signature verifies with the device public key.
  const verified = await verifyHandoverChallengeWithKey(challenge, rawPub, {
    deviceDid: realDid,
    approvedScope: ["profile:settings", "profile:home-state", "profile:wnfs-snapshot"],
    now: NOW,
  });
  assert.equal(verified.device, realDid);
  assert.equal(verified.status, "ready");
  assert.match(handoverConfirmationCode(challenge), /^[0-9A-F]{3}-[0-9A-F]{3}$/);
});

test("a challenge for another device, expired, revoked or cancelled is refused", async () => {
  const pair = await devicePair();
  const other = await devicePair();
  const { did: realDid, raw: rawPub } = await didOf(pair);
  const { did: otherDid } = await didOf(other);
  const { challenge } = await createHandoverChallenge(realDid, "My Android", ["profile:settings"], NOW, pair);

  await assert.rejects(
    verifyHandoverChallenge(challenge, { deviceDid: otherDid, now: NOW }),
    /wrong-device/,
  );
  await assert.rejects(
    verifyHandoverChallenge(challenge, { deviceDid: realDid, now: NOW + HANDOVER_TTL_MS + 1 }),
    /expired/,
  );
  await assert.rejects(
    verifyHandoverChallenge(challenge, { deviceDid: realDid, now: NOW, revoked: new Set([realDid]) }),
    /revoked/,
  );
  await assert.rejects(
    verifyHandoverChallenge(challenge, { deviceDid: realDid, now: NOW, cancelled: true }),
    /cancelled/,
  );
  await assert.rejects(
    verifyHandoverChallenge(challenge, { deviceDid: realDid, now: NOW, approvedScope: ["profile:home-state"] }),
    /scope-not-approved/,
  );
  await assert.rejects(
    verifyHandoverChallengeWithKey({ ...challenge, deviceName: "Forged" }, rawPub, { deviceDid: realDid, now: NOW }),
    /invalid-signature/,
  );
});

test("QR/Passkey approval does not copy a profile: transfer is a separate sealed envelope", async () => {
  const pair = await devicePair();
  const { did: realDid, raw: rawPub } = await didOf(pair);
  const { challenge, ephemeralPrivateKey } = await createHandoverChallenge(realDid, "My Android", ["profile:settings"], NOW, pair);

  // Verifying the challenge alone yields no profile.
  const verified = await verifyHandoverChallengeWithKey(challenge, rawPub, { deviceDid: realDid, now: NOW });
  assert.ok(!("profile" in verified));
  assert.ok(!("payload" in verified));

  // Only the sealed envelope carries the selected-profile payload.
  const payload = { scope: "profile:settings", locale: "ja-JP", homeBackground: "auto" };
  const sealed = await sealProfileTransfer(challenge, payload);
  assert.ok(!sealed.includes("ja-JP"));
  assert.deepEqual(await openProfileTransfer(challenge, ephemeralPrivateKey, sealed), payload);

  // The wrong device cannot open the envelope.
  const otherPair = await devicePair();
  const { did: otherDid } = await didOf(otherPair);
  const { ephemeralPrivateKey: otherEph } =
    await createHandoverChallenge(otherDid, "Other", ["profile:settings"], NOW, otherPair);
  await assert.rejects(openProfileTransfer(challenge, otherEph, sealed), /cannot-decrypt/);
});

test("no secret or owner authentication material is ever copied", async () => {
  const pair = await devicePair();
  const { did: realDid } = await didOf(pair);
  const { challenge } = await createHandoverChallenge(realDid, "My Android", ["profile:settings"], NOW, pair);
  for (const bad of [{ seed: "word" }, { pin: "1234" }, { privateKey: "x" }, { walletPrivateKey: "y" }, { mnemonic: "z" }, { secret: "s" }]) {
    await assert.rejects(sealProfileTransfer(challenge, bad), /forbidden-field/);
    assert.equal(hasForbiddenKey(bad), true);
  }
  assert.equal(hasForbiddenKey({ locale: "ja-JP" }), false);
});

test("unimplemented scopes report truthful unavailable/defer, never ready", async () => {
  assert.equal(transferStatus(["profile:settings"]), "ready");
  assert.equal(transferStatus(["profile:wnfs-snapshot"]), "unavailable");
  assert.equal(transferStatus(["profile:settings", "profile:yotei-events"]), "unavailable");
  const pair = await devicePair();
  const { did: realDid, raw: rawPub } = await didOf(pair);
  const { challenge } = await createHandoverChallenge(realDid, "My Android", ["profile:wnfs-snapshot"], NOW, pair);
  const verified = await verifyHandoverChallengeWithKey(challenge, rawPub, { now: NOW });
  assert.equal(verified.status, "unavailable");
  await assert.rejects(sealProfileTransfer(challenge, { snapshotCid: "bafy" }), /profile-transfer-unavailable/);
});

test("device name and scope validation are strict", async () => {
  const pair = await devicePair();
  const { did } = await didOf(pair);
  await assert.rejects(createHandoverChallenge(did, "", ["profile:settings"], NOW, pair), /invalid-challenge/);
  await assert.rejects(createHandoverChallenge(did, "a".repeat(65), ["profile:settings"], NOW, pair), /invalid-challenge/);
  await assert.rejects(createHandoverChallenge(did, "My Android", [], NOW, pair), /invalid-challenge/);
  await assert.rejects(createHandoverChallenge(did, "My Android", ["profile:evil"], NOW, pair), /invalid-challenge/);
  await assert.rejects(createHandoverChallenge(did, "My Android", ["profile:settings"], NOW, { publicKey: pair.publicKey }), /device-key-unavailable/);
});
