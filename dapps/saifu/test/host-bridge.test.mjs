import assert from "node:assert/strict";
import { test } from "node:test";
import { installSaifuGuestBridge } from "../app/src/saifu/host-bridge.js";
import { createSaifuHostBroker } from "../../../nixos/otehon/shell/src/saifu-host.js";

const address = "0x00000000000000000000000000000000000000AB";
const request = { jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] };
function setup() {
  const listeners = {};
  const win = { parent: {}, addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener(type) { delete listeners[type]; } };
  const bridge = installSaifuGuestBridge(win);
  const channel = new MessageChannel();
  return { win, listeners, bridge, channel };
}

test("only the parent can establish the host channel; reads use a bounded message", async () => {
  const { win, listeners, bridge, channel } = setup();
  listeners.message({ source: {}, data: { protocol: "kotoba.client.host.v1" }, ports: [channel.port1] });
  await assert.rejects(win.saifuHost.readChainState(request), /unavailable/);
  listeners.message({ source: win.parent, data: { protocol: "kotoba.client.host.v1" }, ports: [channel.port1] });
  const message = new Promise((resolve) => { channel.port2.onmessage = ({ data }) => resolve(data); });
  const result = win.saifuHost.readChainState(request);
  const sent = await message;
  assert.deepEqual(sent.payload, { address });
  assert.equal(sent.selector.operation, "read-eth-balance");
  channel.port2.postMessage({ id: sent.id, ok: true, status: 200, content: '{"jsonrpc":"2.0","id":1,"result":"0x1"}' });
  assert.equal((await result).result, "0x1");
  bridge.close(); channel.port2.close();
});

test("unsupported requests and host refusal fail closed", async () => {
  const { win, listeners, bridge, channel } = setup();
  listeners.message({ source: win.parent, data: { protocol: "kotoba.client.host.v1" }, ports: [channel.port1] });
  await assert.rejects(win.saifuHost.readChainState({ ...request, method: "eth_sendTransaction" }), /not-supported/);
  const message = new Promise((resolve) => { channel.port2.onmessage = ({ data }) => resolve(data); });
  const result = win.saifuHost.readChainState(request);
  const sent = await message;
  channel.port2.postMessage({ id: sent.id, ok: false, error: "not approved" });
  await assert.rejects(result, /refused/);
  bridge.close(); channel.port2.close();
});

test("closing the guest rejects pending operations", async () => {
  const { win, listeners, bridge, channel } = setup();
  listeners.message({ source: win.parent, data: { protocol: "kotoba.client.host.v1" }, ports: [channel.port1] });
  const result = win.saifuHost.readChainState(request);
  bridge.close();
  await assert.rejects(result, /closed/);
  channel.port2.close();
});

test("oversized or malformed RPC balances never reach the Dapp core", async () => {
  for (const resultValue of ["0x00", "0x" + "f".repeat(65)]) {
    const { win, listeners, bridge, channel } = setup();
    listeners.message({ source: win.parent, data: { protocol: "kotoba.client.host.v1" }, ports: [channel.port1] });
    const message = new Promise((resolve) => { channel.port2.onmessage = ({ data }) => resolve(data); });
    const result = win.saifuHost.readChainState(request);
    const sent = await message;
    channel.port2.postMessage({ id: sent.id, ok: true, status: 200, content: JSON.stringify({ jsonrpc: "2.0", id: 1, result: resultValue }) });
    await assert.rejects(result, /invalid-response/);
    bridge.close(); channel.port2.close();
  }
});

test("guest and restricted host exchange one fixed balance request", async () => {
  const { win, listeners, bridge, channel } = setup();
  let call;
  const host = createSaifuHostBroker({ invoke: async (selector, payload) => {
    call = { selector, payload };
    return { ok: true, status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xde0b6b3a7640000" }) };
  } });
  channel.port2.onmessage = async ({ data }) => {
    try {
      const response = await host.invoke(data.selector, data.payload);
      channel.port2.postMessage({ id: data.id, ok: true, status: response.status, content: response.body });
    } catch (error) { channel.port2.postMessage({ id: data.id, ok: false, error: error.message }); }
  };
  listeners.message({ source: win.parent, data: { protocol: "kotoba.client.host.v1" }, ports: [channel.port1] });
  assert.equal((await win.saifuHost.readChainState(request)).result, "0xde0b6b3a7640000");
  assert.equal(call.payload.input, "https://mainnet.optimism.io/");
  assert.equal(JSON.parse(call.payload.init.body).method, "eth_getBalance");
  bridge.close(); channel.port2.close();
});
