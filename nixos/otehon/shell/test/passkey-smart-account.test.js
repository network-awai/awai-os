import assert from "node:assert/strict";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import { candidateFromPasskeyLink, counterfactualPasskeyAddress } from "../src/passkey-smart-account.js";
import { createLinkRequest, p256Did } from "../src/identity/link.js";
import { passkeyResponse, randomWallet, walletResponse } from "./signers.js";

const input = () => ({
  ownerPublicKey: p256.Point.BASE.toBytes(false), nonce: 0n,
  factory: "0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842",
  implementation: "0x00000110dCdEdC9581cb5eCB8467282f2926534d",
});

test("public P-256 owner matches the Cloud Itonami pinned factory vector", () => {
  assert.equal(counterfactualPasskeyAddress(input()), "0x4bF597E75af919CDbB04505C39F4957454262011");
});

test("address calculation rejects invalid inputs and never infers a factory or nonce", () => {
  assert.throws(() => counterfactualPasskeyAddress({ ...input(), ownerPublicKey: new Uint8Array(65) }), /public-key/);
  assert.throws(() => counterfactualPasskeyAddress({ ...input(), nonce: -1n }), /nonce/);
  assert.throws(() => counterfactualPasskeyAddress({ ...input(), nonce: 1 }), /nonce/);
  assert.throws(() => counterfactualPasskeyAddress({ ...input(), factory: undefined }), /factory-configuration/);
  assert.notEqual(counterfactualPasskeyAddress({ ...input(), nonce: 1n }), counterfactualPasskeyAddress(input()));
});

test("a verified Passkey link yields only an explicitly configured unbound candidate", async () => {
  const now = Date.parse("2026-11-07T00:00:00Z");
  const deviceDid = p256Did(p256.getPublicKey(p256.utils.randomSecretKey()));
  const { request } = await createLinkRequest(deviceDid, now);
  const secret = p256.utils.randomSecretKey();
  const response = passkeyResponse(secret, request, now);
  const params = { request, response, deviceDid, now, ...input() };
  const candidate = candidateFromPasskeyLink(params);
  assert.equal(candidate.identityDid, p256Did(p256.getPublicKey(secret)));
  assert.equal(candidate.status, "unbound-candidate");
  assert.equal(candidate.address, counterfactualPasskeyAddress({ ...input(), ownerPublicKey: p256.getPublicKey(secret, false) }));
  assert.throws(() => candidateFromPasskeyLink({ ...params, nonce: undefined }), /nonce/);
  assert.throws(() => candidateFromPasskeyLink({ ...params, response: { ...response, signature: "AA" } }), /invalid-signature/);
  assert.throws(() => candidateFromPasskeyLink({ ...params, response: passkeyResponse(secret, request, now, { rpId: "evil.example" }) }), /wrong-rp/);
  assert.throws(() => candidateFromPasskeyLink({ ...params, response: walletResponse(randomWallet(), request, now) }), /passkey-required/);
});
