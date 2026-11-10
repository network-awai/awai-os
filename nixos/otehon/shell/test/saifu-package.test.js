import assert from "node:assert/strict";
import { test } from "node:test";
import { admitSaifuPackage } from "../src/saifu-package.js";

const encoder = new TextEncoder();
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const digest = async (bytes) => hex(await crypto.subtle.digest("SHA-256", bytes));
const runtime = () => ({
  schema: "kotoba.app.client-runtime.v1", target: "browser", profile: "trusted-page-v1", entry: "saifu.html",
  "local-state": { adapter: "memory", schema: "awai.saifu", version: 1 }, workers: [],
  operations: [{ capability: "awai-wallet", service: "optimism-public-rpc", operation: "read-eth-balance",
    consent: "each-operation", "data-categories": ["wallet-address"],
    endpoint: { origin: "https://mainnet.optimism.io", method: "POST", path: "/" } }],
});

async function fixture(value = runtime()) {
  const key = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publisherKey = hex(await crypto.subtle.exportKey("raw", key.publicKey));
  const descriptorBytes = encoder.encode(JSON.stringify(value));
  const signature = hex(await crypto.subtle.sign("Ed25519", key.privateKey, descriptorBytes));
  const appBytes = encoder.encode("<main>test-only Saifu</main>");
  return { descriptorBytes, signature, publisherKey, appBytes, pins: {
    publisherKey, revision: "a".repeat(40), descriptorSha256: await digest(descriptorBytes),
    appSha256: await digest(appBytes), appMaxBytes: 1024,
  } };
}

test("host-pinned signed descriptor and app bytes are independently admitted", async () => {
  const input = await fixture();
  const result = await admitSaifuPackage(input);
  assert.equal(result.descriptor.publicKey, input.publisherKey);
  assert.equal(result.artifact.verified, true);
  assert.equal(result.artifact.sha256, input.pins.appSha256);
});

test("changed publisher, descriptor signature, or app bytes fail closed", async () => {
  const input = await fixture();
  await assert.rejects(admitSaifuPackage({ ...input, pins: { ...input.pins, publisherKey: "0".repeat(64) } }), /publisher/);
  await assert.rejects(admitSaifuPackage({ ...input, signature: "0".repeat(128) }), /signature/);
  await assert.rejects(admitSaifuPackage({ ...input, appBytes: encoder.encode("changed") }), /digest/);
  await assert.rejects(admitSaifuPackage({ ...input, pins: undefined }), /pins-required/);
});

test("even a valid publisher cannot broaden the declared Saifu operation", async () => {
  for (const mutate of [
    (d) => { d.operations[0].endpoint.origin = "https://example.com"; },
    (d) => { d.operations[0]["data-categories"].push("conversation"); },
    (d) => { d.operations.push({ ...d.operations[0], operation: "send" }); },
    (d) => { d["local-state"].adapter = "localstorage"; },
  ]) {
    const value = runtime(); mutate(value);
    await assert.rejects(admitSaifuPackage(await fixture(value)), /descriptor-not-supported/);
  }
});
