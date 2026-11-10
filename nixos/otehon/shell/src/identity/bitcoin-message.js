// BIP-322's message commitment only. This does not verify a Bitcoin signature,
// an address, a virtual transaction, or an account binding.
import { sha256 } from "@noble/hashes/sha2.js";

const tagHash = sha256(new TextEncoder().encode("BIP0322-signed-message"));

export function bip322MessageHash(message) {
  if (typeof message !== "string") throw new TypeError("message must be text");
  const bytes = new TextEncoder().encode(message);
  if (bytes.length > 65536) throw new Error("message-too-large");
  const input = new Uint8Array(tagHash.length * 2 + bytes.length);
  input.set(tagHash, 0);
  input.set(tagHash, tagHash.length);
  input.set(bytes, tagHash.length * 2);
  return sha256(input);
}
