import test from "node:test";
import assert from "node:assert/strict";
import { parseOffer, offerPayload, signOffer, computeOperations } from "../src/awai-compute.js";

const offer = {
  amount: 1, consumer: "did:key:z6MkoDVoiKnHXT6Y5kgmtBpARathJGAhCpe4MjbDTREsMAZe", "chain-id": "awai-en-devnet/test",
  "expires-ms": 1794961807261, kind: ":awai-compute-offer", notices: [":devnet-not-money"],
  provider: "did:key:z6MkmGjtqzPG1XGRSf79V2UynNrrcc8goByntYwBGgQVFh49", route: ":en-devnet",
  target: "awai-compute", "value-class": ":devnet", wording: ":provide",
  "order-id": "compute-0123456789abcdef01234567",
};
const text = (c) => JSON.stringify(c);

test("no desk origin means no compute operations", () => {
  assert.deepEqual(computeOperations(""), []);
  assert.deepEqual(computeOperations(undefined), []);
});

test("compute operations are https, each-operation, on the declared origin only", () => {
  const ops = computeOperations("https://localhost:18796");
  assert.equal(ops.length, 3);
  for (const op of ops) {
    assert.equal(op.consent, "each-operation");
    assert.equal(op.endpoint.origin, "https://localhost:18796");
  }
  assert.throws(() => computeOperations("http://localhost:18796"), /invalid-compute-desk-origin/);
});

test("a devnet offer parses", () => {
  const c = parseOffer(text(offer));
  assert.equal(c.provider, offer.provider);
  assert.equal(c.amount, 1);
  assert.equal(c.orderId, "compute-0123456789abcdef01234567");
});

test("offers that are not devnet compute offers are refused", () => {
  for (const change of [{ "value-class": ":live" }, { wording: ":support" }, { route: ":card" },
    { amount: 0 }, { "order-id": "x" }, { provider: "someone" }]) {
    assert.throws(() => parseOffer(text({ ...offer, ...change })), /invalid-compute-offer/);
  }
});

test("the offer binds the exact offer text", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const a = await signOffer(pair, text(offer));
  assert.equal(a.payload, await offerPayload(text(offer)));
  assert.notEqual(a.payload, await offerPayload(text({ ...offer, amount: 2 })));
  assert.match(a.payload, /^awai\.compute\.offer\/1\noffer-sha256=[0-9a-f]{64}\ndecision=offer$/);
});
