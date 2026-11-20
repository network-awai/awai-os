import test from "node:test";
import assert from "node:assert/strict";
import { approvalPayload, parseCard, signApproval, supportOperations } from "../src/awai-support.js";

const card = {
  amount: 1, bot: "did:key:z6MkmGjtqzPG1XGRSf79V2UynNrrcc8goByntYwBGgQVFh49", "chain-id": "awai-en-devnet/test",
  "expires-ms": 1794961807261, kind: ":consent-card", notices: [":devnet-not-money"], purpose: ["creative work"],
  recipient: { kind: ":llc", "legal-name": "Awai Network LLC" }, route: ":en-devnet",
  sponsor: "did:key:z6MkoDVoiKnHXT6Y5kgmtBpARathJGAhCpe4MjbDTREsMAZe", target: "awai-support",
  "transfer-id": "support-0123456789abcdef01234567", "value-class": ":devnet", wording: ":support",
};
const text = (c) => JSON.stringify(c);

test("no desk origin means no support operations", () => {
  assert.deepEqual(supportOperations(""), []);
  assert.deepEqual(supportOperations(undefined), []);
});

test("support operations are https, each-operation, on the declared origin only", () => {
  const ops = supportOperations("https://localhost:18795");
  assert.equal(ops.length, 3);
  for (const op of ops) {
    assert.equal(op.consent, "each-operation");
    assert.equal(op.endpoint.origin, "https://localhost:18795");
  }
  assert.throws(() => supportOperations("http://localhost:18795"), /invalid-support-desk-origin/);
});

test("a devnet card for Awai Network LLC parses", () => {
  const c = parseCard(text(card));
  assert.equal(c.recipient, "Awai Network LLC");
  assert.equal(c.amount, 1);
});

test("cards that are not devnet support for Awai Network LLC are refused", () => {
  for (const change of [{ "value-class": ":live" }, { wording: ":donation" }, { route: ":card" },
    { recipient: { "legal-name": "Someone Else" } }, { amount: 0 }, { "transfer-id": "x" }]) {
    assert.throws(() => parseCard(text({ ...card, ...change })), /invalid-support-card/);
  }
});

test("the approval binds the exact card text", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const a = await signApproval(pair, text(card));
  assert.equal(a.payload, await approvalPayload(text(card)));
  assert.notEqual(a.payload, await approvalPayload(text({ ...card, amount: 2 })));
  assert.match(a.payload, /^awai\.support\.approval\/1\ncard-sha256=[0-9a-f]{64}\ndecision=approve$/);
});
