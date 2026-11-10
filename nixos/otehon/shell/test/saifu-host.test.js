import assert from "node:assert/strict";
import { test } from "node:test";
import { createSaifuHostBroker } from "../src/saifu-host.js";

const selector = { capability: "awai-wallet", service: "optimism-public-rpc", operation: "read-eth-balance" };
const address = "0x00000000000000000000000000000000000000AB";

test("Saifu can request only the host-constructed balance read through the shared broker", async () => {
  const calls = [];
  const response = { ok: true };
  const host = createSaifuHostBroker({ invoke: async (...args) => { calls.push(args); return response; } }, { getScore: () => 50 });
  const signal = new AbortController().signal;
  assert.equal(await host.invoke(selector, { address }, { signal }), response);
  assert.deepEqual(calls[0][0], selector);
  assert.equal(calls[0][1].input, "https://mainnet.optimism.io/");
  assert.deepEqual(JSON.parse(calls[0][1].init.body), { jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] });
  assert.equal(calls[0][2].signal, signal);
});

test("Saifu cannot choose another endpoint, method, selector or invalid address", async () => {
  let calls = 0;
  const host = createSaifuHostBroker({ invoke() { calls++; } }, { getScore: () => 50 });
  for (const [s, p] of [
    [{ ...selector, operation: "send-transaction" }, { address }],
    [{ ...selector, extra: true }, { address }],
    [selector, { address, method: "eth_sendTransaction" }],
    [selector, { address, input: "https://example.com" }],
    [selector, { address: "invalid" }],
  ]) await assert.rejects(host.invoke(s, p));
  assert.equal(calls, 0);
});

test("a denied operation propagates without returning fabricated data", async () => {
  const host = createSaifuHostBroker({ invoke: async () => { throw Error("client operation was not approved"); } }, { getScore: () => 50 });
  await assert.rejects(host.invoke(selector, { address }), /not approved/);
});

test("Saifu checks the host's current operation score before invoking the broker", async () => {
  let score = 50;
  let calls = 0;
  const broker = { invoke: async () => { calls++; return { ok: true }; } };
  const host = createSaifuHostBroker(broker, { getScore: () => score });
  await host.invoke(selector, { address });
  score = 10;
  await assert.rejects(host.invoke(selector, { address }), /trust-insufficient/);
  await assert.rejects(createSaifuHostBroker(broker).invoke(selector, { address }), /trust-insufficient/);
  assert.equal(calls, 1);
});
