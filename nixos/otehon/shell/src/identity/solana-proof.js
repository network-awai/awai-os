// A narrow, offline SIWS asset-key proof. This does not create a binding:
// the account must separately authorize the same challenge. Direct callers of
// verifySolanaAssetProof must enforce one-time consumption themselves.
import { ed25519 } from "@noble/curves/ed25519.js";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const encoder = new TextEncoder();
const lifetime = 5 * 60 * 1000;

function solanaKey(address) {
  if (typeof address !== "string" || address.length < 32 || address.length > 44) throw new Error("invalid-solana-address");
  let value = 0n;
  for (const char of address) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error("invalid-solana-address");
    value = value * 58n + BigInt(digit);
  }
  const bytes = [];
  while (value > 0n) { bytes.unshift(Number(value & 255n)); value >>= 8n; }
  for (const char of address) { if (char !== "1") break; bytes.unshift(0); }
  if (bytes.length !== 32) throw new Error("invalid-solana-address");
  return Uint8Array.from(bytes);
}

// Only this exact subset is supported; callers must retain the challenge they
// created rather than accepting the wallet's returned fields as expectations.
export function solanaProofMessage({ accountDid, address, nonce, issuedAt, expirationTime }, now = Date.now()) {
  solanaKey(address);
  if (typeof accountDid !== "string" || !/^did:(?:key|pkh):[A-Za-z0-9:.%-]{1,240}$/.test(accountDid)) throw new Error("invalid-account");
  if (typeof nonce !== "string" || !/^[a-f0-9]{32}$/.test(nonce)) throw new Error("invalid-nonce");
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expirationTime);
  if (!Number.isFinite(now) || !Number.isFinite(issued) || !Number.isFinite(expires)
      || new Date(issued).toISOString() !== issuedAt || new Date(expires).toISOString() !== expirationTime
      || expires - issued !== lifetime || issued > now || now >= expires) throw new Error("invalid-proof-window");
  return `${"awai.network"} wants you to sign in with your Solana account:\n${address}\n\nLink this Solana address to ${accountDid}\n\nURI: https://awai.network/link/\nVersion: 1\nChain ID: mainnet\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expirationTime}`;
}

export function verifySolanaAssetProof(challenge, output, now = Date.now()) {
  const message = encoder.encode(solanaProofMessage(challenge, now));
  if (!output || !(output.signedMessage instanceof Uint8Array) || !(output.signature instanceof Uint8Array)
      || output.signature.length !== 64 || (output.signatureType !== undefined && output.signatureType !== "ed25519")
      || output.signedMessage.length !== message.length
      || !message.every((byte, i) => byte === output.signedMessage[i])) throw new Error("invalid-solana-proof");
  let valid = false;
  try { valid = ed25519.verify(output.signature, message, solanaKey(challenge.address), { zip215: false }); } catch { /* refuse */ }
  if (!valid) throw new Error("invalid-solana-proof");
  return Object.freeze({ status: "asset-proof-only", accountDid: challenge.accountDid, address: challenge.address });
}

// Ephemeral request object for a future host-driven consent flow. It never
// creates a binding or grants signing authority, and does not persist a nonce.
// The account DID must come from the host's verified identity, not the guest.
export function createSolanaProofSession({ accountDid, address }, { clock = Date.now } = {}) {
  const issued = clock();
  if (!Number.isFinite(issued)) throw new Error("invalid-proof-window");
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
  const challenge = Object.freeze({ accountDid, address, nonce,
    issuedAt: new Date(issued).toISOString(), expirationTime: new Date(issued + lifetime).toISOString() });
  // Validate fields before exposing an input to a wallet.
  solanaProofMessage(challenge, issued);
  let consumed = false;
  const input = Object.freeze({ domain: "awai.network", address,
    statement: `Link this Solana address to ${accountDid}`, uri: "https://awai.network/link/",
    version: "1", chainId: "mainnet", nonce, issuedAt: challenge.issuedAt, expirationTime: challenge.expirationTime });
  return Object.freeze({ input, verify(output) {
    if (consumed) throw new Error("solana-proof-consumed");
    const result = verifySolanaAssetProof(challenge, output, clock());
    consumed = true;
    return result;
  } });
}
