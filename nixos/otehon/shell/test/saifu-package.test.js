import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { admitSaifuPackage } from "../src/saifu-package.js";
import { saifuContentCsp, verifySaifuBundle } from "../src/saifu-bundle.js";

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

async function fixture(value = runtime(), appHtml = "<main>test-only Saifu</main>") {
  const key = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publisherKey = hex(await crypto.subtle.exportKey("raw", key.publicKey));
  const descriptorBytes = encoder.encode(JSON.stringify(value));
  const signature = hex(await crypto.subtle.sign("Ed25519", key.privateKey, descriptorBytes));
  const appBytes = encoder.encode(appHtml);
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

test("CSP admits only the exact verified Saifu script and style", async () => {
  const style = "body{color:#123}";
  const script = "window.saifuFixture=true;";
  const input = await fixture(runtime(), `<style>${style}</style><div id="saifu"></div><script>${script}</script>`);
  const bundle = { publisherKey: input.publisherKey, signature: input.signature,
    descriptor: Buffer.from(input.descriptorBytes).toString("base64"), app: Buffer.from(input.appBytes).toString("base64") };
  const csp = await saifuContentCsp(bundle, input.pins);
  const hash = (text) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;
  assert.deepEqual(csp, { script: hash(script), style: hash(style) });
  await assert.rejects(verifySaifuBundle({ ...bundle, app: Buffer.from("changed").toString("base64") }, input.pins), /digest/);
  await assert.rejects(verifySaifuBundle({ ...bundle, extra: true }, input.pins), /invalid-bundle/);
});

test("a signed bundle cannot add another HTML script or escape its style", async () => {
  for (const html of [
    '<style>body{}</style><div id="saifu"></div><script>x</script><script>y</script>',
    '<style>x</style><style>y</style><div id="saifu"></div><script>x</script>',
  ]) {
    const input = await fixture(runtime(), html);
    const bundle = { publisherKey: input.publisherKey, signature: input.signature,
      descriptor: Buffer.from(input.descriptorBytes).toString("base64"), app: Buffer.from(input.appBytes).toString("base64") };
    await assert.rejects(verifySaifuBundle(bundle, input.pins), /invalid-html-envelope/);
  }
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

test("admission snapshots trusted pins and bytes before asynchronous verification", async () => {
  const input = await fixture();
  const expected = input.pins.appSha256;
  const result = admitSaifuPackage(input);
  input.appBytes[0] ^= 1;
  input.pins.appSha256 = "0".repeat(64);
  assert.equal((await result).artifact.sha256, expected);
});

test("oversized packages are refused before parsing or mounting", async () => {
  const input = await fixture();
  await assert.rejects(admitSaifuPackage({ ...input, pins: { ...input.pins, appMaxBytes: 8388609 } }), /invalid-size/);
  await assert.rejects(admitSaifuPackage({ ...input, appBytes: new Uint8Array(1025) }), /invalid-size/);
});
