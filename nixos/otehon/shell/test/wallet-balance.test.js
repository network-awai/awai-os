import assert from "node:assert/strict";
import { test } from "node:test";
import { readWalletBalance } from "../src/runtime.js";

const address = "0x00000000000000000000000000000000000000AB";

test("balance uses the declared broker operation and fixed Optimism RPC method", async () => {
  let call;
  const broker = { invoke: async (selector, payload) => {
    call = { selector, payload };
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x14d1120d7b160000" }) };
  } };
  assert.equal(await readWalletBalance(broker, address), "1.5");
  assert.deepEqual(call.selector, { capability: "awai-wallet", service: "optimism-public-rpc", operation: "read-eth-balance" });
  assert.equal(call.payload.input, "https://mainnet.optimism.io/");
  assert.deepEqual(JSON.parse(call.payload.init.body), { jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] });
});

test("invalid addresses are rejected before invoking the broker", async () => {
  let invoked = false;
  await assert.rejects(readWalletBalance({ invoke() { invoked = true; } }, "0xno"), /invalid-wallet-address/);
  assert.equal(invoked, false);
});

test("denial and malformed RPC results do not become a balance", async () => {
  await assert.rejects(readWalletBalance({ invoke: async () => { throw Error("client operation was not approved"); } }, address), /not approved/);
  for (const result of ["0x", "0x00", "0x" + "f".repeat(65), 5]) {
    await assert.rejects(readWalletBalance({ invoke: async () => ({ ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result }) }) }, address), /invalid-balance-response/);
  }
});
