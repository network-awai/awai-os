import assert from "node:assert/strict";
import { test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { solanaProofMessage, verifySolanaAssetProof } from "../src/identity/solana-proof.js";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let result = "";
  while (value > 0n) { result = alphabet[Number(value % 58n)] + result; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; result = `1${result}`; }
  return result;
}
const now = Date.parse("2026-11-10T00:00:00.000Z");
function fixture() {
  const secret = ed25519.utils.randomSecretKey();
  const challenge = { accountDid: "did:key:zExample", address: base58(ed25519.getPublicKey(secret)),
    nonce: "1234567890abcdef1234567890abcdef", issuedAt: new Date(now).toISOString(),
    expirationTime: new Date(now + 300000).toISOString() };
  const signedMessage = new TextEncoder().encode(solanaProofMessage(challenge, now));
  const signature = ed25519.sign(signedMessage, secret);
  return { challenge, output: { signedMessage, signature } };
}

test("a Solana signature proves only the asset-key side of the exact challenge", () => {
  const { challenge, output } = fixture();
  assert.deepEqual(verifySolanaAssetProof(challenge, output, now), {
    status: "asset-proof-only", accountDid: challenge.accountDid, address: challenge.address,
  });
  assert.match(new TextDecoder().decode(output.signedMessage), /^awai\.network wants you to sign in with your Solana account:/);
});

test("wrong account, key, nonce, origin text, signature, or expired challenge is refused", () => {
  const { challenge, output } = fixture();
  const other = fixture();
  for (const changed of [
    { ...challenge, accountDid: "did:key:zOther" }, { ...challenge, address: other.challenge.address },
    { ...challenge, nonce: "0".repeat(32) },
  ]) assert.throws(() => verifySolanaAssetProof(changed, output, now), /invalid-solana-proof/);
  assert.throws(() => verifySolanaAssetProof(challenge, { ...output, signature: other.output.signature }, now), /invalid-solana-proof/);
  assert.throws(() => verifySolanaAssetProof(challenge, { ...output, signedMessage: new TextEncoder().encode("https://evil.example") }, now), /invalid-solana-proof/);
  assert.throws(() => verifySolanaAssetProof(challenge, output, now + 300000), /invalid-proof-window/);
  assert.throws(() => solanaProofMessage({ ...challenge, address: "0invalid" }, now), /invalid-solana-address/);
  assert.throws(() => solanaProofMessage({ ...challenge, nonce: "short" }, now), /invalid-nonce/);
});
