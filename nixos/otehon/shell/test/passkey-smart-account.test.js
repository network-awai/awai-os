import assert from "node:assert/strict";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import { counterfactualPasskeyAddress } from "../src/passkey-smart-account.js";

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
