import assert from "node:assert/strict";
import { test } from "node:test";
import { bip322MessageHash } from "../src/identity/bitcoin-message.js";

// Public BIP-322 basic-test-vectors.json: message_hash, not signature validity.
test("BIP-322 message commitments match the Bitcoin BIPs public vectors", () => {
  const vectors = [
    ["", "c90c269c4f8fcbe6880f72a721ddfbf1914268a794cbb21cfafee13770ae19f1"],
    ["Hello World", "f0eb03b1a75ac6d9847f55c624a99169b5dccba2a31f5b23bea77ba270de0a7a"],
    ["UTF-8 support: öäüéàè 测试文本 😄", "43936b237ea38c7794eb5d755e0d220b6db92ebfc5c8f482759d22b1286376d7"],
  ];
  for (const [message, expected] of vectors) assert.equal(Buffer.from(bip322MessageHash(message)).toString("hex"), expected);
  assert.throws(() => bip322MessageHash(null), /message must be text/);
  assert.throws(() => bip322MessageHash("x".repeat(65537)), /message-too-large/);
});
