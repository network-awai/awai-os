import assert from "node:assert/strict";
import { test } from "node:test";
import { clientRuntimeConnectSrc, clientRuntimeProblems } from "../vendor/kotoba-client-runtime.js";
import { osOperations, phoneOperations, runtimeDescriptor } from "../src/runtime.js";
import {
  PROOF_MAX_AGE_MS,
  accountAddress,
  dappMinimum,
  operationMinimum,
  parsePassportResponse,
  passportCall,
  trustScore,
} from "../src/trust.js";

const ACCOUNT = "did:pkh:eip155:1:0x0000000000000000000000000000000000000001";
const NOW = 1_000_000_000_000;
const passport = (score, overrides = {}) => ({ account: ACCOUNT, score, checkedAt: NOW, ...overrides });

test("the score starts at login and adds each valid proof", () => {
  assert.equal(trustScore({ accountDid: null, now: NOW }), 0);
  assert.equal(trustScore({ accountDid: ACCOUNT, now: NOW }), 10);
  assert.equal(trustScore({ accountDid: ACCOUNT, proofs: { passport: passport(20) }, now: NOW }), 50);
  const worldId = { account: ACCOUNT, verified: true, checkedAt: NOW };
  assert.equal(trustScore({ accountDid: ACCOUNT, proofs: { passport: passport(20), worldId }, now: NOW }), 100);
});

test("weak, old, future or other-account proofs add nothing", () => {
  for (const proof of [
    passport(19.9),
    passport(50, { account: "did:key:zOther" }),
    passport(50, { checkedAt: NOW - PROOF_MAX_AGE_MS - 1 }),
    passport(50, { checkedAt: NOW + 1 }),
    null,
  ]) {
    assert.equal(trustScore({ accountDid: ACCOUNT, proofs: { passport: proof }, now: NOW }), 10);
  }
});

test("minimums apply to the listed operations and to whole dapps", () => {
  assert.equal(operationMinimum("torihiki", "submit-order"), 50);
  assert.equal(operationMinimum("torihiki", "read-quotes"), 0);
  assert.equal(operationMinimum("saifu", "read-chain-state"), 50);
  assert.equal(dappMinimum("bunsho"), 0);
  const table = { closed: { minimum: 60, operations: { read: 20 } } };
  assert.equal(dappMinimum("closed", table), 60);
  assert.equal(operationMinimum("closed", "read", table), 60);
});

test("only did:pkh has an address for the onchain score", () => {
  assert.equal(accountAddress(ACCOUNT), "0x0000000000000000000000000000000000000001");
  assert.equal(accountAddress("did:key:zDn"), null);
});

test("the passport read is encoded and parsed", () => {
  const call = passportCall("0x00000000000000000000000000000000000000AB");
  assert.equal(call.params[0].data, `0xd47875d0${"ab".padStart(64, "0")}`);
  assert.equal(parsePassportResponse({ result: `0x${(250000).toString(16).padStart(64, "0")}` }), 25);
  assert.equal(parsePassportResponse({ error: { message: "execution reverted" } }), 0);
  assert.throws(() => parsePassportResponse({ error: { message: "rate limited" } }), /chain-read-failed/);
  assert.throws(() => parsePassportResponse({ result: "0x" }), /chain-read-failed/);
});

test("the shared broker accepts both descriptors", () => {
  const relay = "https://relay.awai.network";
  const os = runtimeDescriptor("index.html", osOperations(relay));
  const phone = runtimeDescriptor("index.html", phoneOperations(relay));
  assert.deepEqual(clientRuntimeProblems(os, ["awai-link", "awai-trust"], []), []);
  assert.deepEqual(clientRuntimeProblems(phone, ["awai-link"], ["https://awai.network"]), []);
  assert.equal(
    clientRuntimeConnectSrc(os, ["awai-link", "awai-trust"], [], []),
    "connect-src https://mainnet.optimism.io https://relay.awai.network",
  );
});
