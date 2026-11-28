import {CHAT_ORIGIN} from '../src/bot-chat-contract.js';
import assert from "node:assert/strict";
import { test } from "node:test";
import { clientRuntimeConnectSrc, clientRuntimeProblems } from "../vendor/kotoba-client-runtime.js";
import { deliverApproval, osOperations, phoneOperations, runtimeDescriptor } from "../src/runtime.js";
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
  const osCapabilities = ["awai-egov", "awai-link", "awai-handover", "awai-trust", "awai-wallet",
    "itonami-bot-chat", "itonami-bot-voice", "itonami-mail-aliases"];
  const phoneCapabilities = ["awai-link", "awai-handover"];
  const phoneOrigins = ["https://awai.network"];
  assert.deepEqual(clientRuntimeProblems(os, osCapabilities, []), []);
  assert.deepEqual(clientRuntimeProblems(phone, phoneCapabilities, phoneOrigins), []);
  assert.equal(
    clientRuntimeConnectSrc(os, osCapabilities, [], []),
    "connect-src " + [CHAT_ORIGIN,"https://laws.e-gov.go.jp","https://mainnet.optimism.io","https://relay.awai.network"].sort().join(" "),
  );
  assert.equal(clientRuntimeConnectSrc(phone, phoneCapabilities, [], phoneOrigins),
    "connect-src https://relay.awai.network");

  const handover = (descriptor) => descriptor.operations.filter(operation => operation.capability === "awai-handover");
  const inspect = ({ operation, consent, endpoint }) => [operation, consent, endpoint.origin, endpoint.routes];
  const deliver = ["deliver-handover-envelope", "each-operation", relay,
    [{ method: "POST", path: "/v1/:topic", "query-params": [] }]];
  assert.deepEqual(handover(os).map(inspect), [
    ["await-handover-approval", "each-operation", relay,
      [{ method: "GET", path: "/v1/:topic/json", "query-params": [] }]],
    deliver,
  ]);
  assert.deepEqual(handover(phone).map(inspect), [deliver]);
  for (const [descriptor, capabilities, origins] of [[os, osCapabilities, []], [phone, phoneCapabilities, phoneOrigins]]) {
    assert.deepEqual(clientRuntimeProblems(descriptor, capabilities.filter(capability => capability !== "awai-handover"), origins),
      handover(descriptor).map(({ capability, service, operation }) => ({
        field: "operations", error: "capability-not-requested", selector: JSON.stringify([capability, service, operation]),
      })));
  }
});

test("a non-32hex link topic fails before deliver-approval sends anything", async () => {
  let calls = 0;
  const broker = { invoke: async () => { calls++; return { ok: true }; } };
  for (const topic of ["fixture", "ABCDEF0123456789ABCDEF0123456789", "a".repeat(31), "a".repeat(33), "", null, 123]) {
    await assert.rejects(deliverApproval(broker, "https://relay.awai.network", topic, "sealed"), /invalid-link-topic/);
  }
  assert.equal(calls, 0, "nothing reaches the broker");
  await deliverApproval(broker, "https://relay.awai.network", "a".repeat(32), "sealed");
  assert.equal(calls, 1, "a 32-hex topic is sent");
});

test("the voice follows the text, and old string messages still read as text", async () => {
  const { describeMessage, voiceFor } = await import("../src/media.js");
  assert.equal(voiceFor("Hello"), "en");
  assert.equal(voiceFor("こんにちは"), "ja");
  assert.equal(voiceFor("東京"), "ja");
  assert.deepEqual(describeMessage("hi"), { kind: "text", text: "hi" });
});
