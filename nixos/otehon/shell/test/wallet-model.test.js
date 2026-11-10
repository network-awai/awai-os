import assert from "node:assert/strict";
import { test } from "node:test";
import { walletView } from "../src/wallet-model.js";

test("Passkey identity does not invent a chain wallet or a balance", () => {
  const view = walletView({ method: "passkey", accountDid: "did:key:zExample" });
  assert.equal(view.identity, "passkey");
  assert.deepEqual(view.assets.map(({ currency, status, address }) => ({ currency, status, address })), [
    { currency: "ETH", status: "not-connected", address: null },
    { currency: "BTC", status: "planned", address: null },
    { currency: "SOL", status: "planned", address: null },
  ]);
});

test("a verified wallet account enables only the existing EVM read", () => {
  const address = "0x00000000000000000000000000000000000000AB";
  const view = walletView({ method: "wallet", accountDid: `did:pkh:eip155:1:${address}` });
  assert.equal(view.assets[0].status, "read-available");
  assert.equal(view.assets[0].address, address);
  assert.deepEqual(view.assets.slice(1).map(({ status }) => status), ["planned", "planned"]);
  assert.equal(walletView({ method: "wallet", accountDid: "did:pkh:eip155:1:not-an-address" }).assets[0].status, "not-connected");
});
