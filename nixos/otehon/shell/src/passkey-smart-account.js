// Public, offline address calculation only. This does not register an owner,
// change a DID, deploy a contract, prove chain readiness, or handle keys.
import { p256 } from "@noble/curves/nist.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { checksumAddress, fromBase64Url, verifyLink } from "./identity/link.js";

const PREFIX = "603d3d8160223d3973";
const SUFFIX = "60095155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3";
const MAX_UINT256 = (1n << 256n) - 1n;

function bytesFromHex(value) {
  return Uint8Array.from(value.match(/../g), (pair) => Number.parseInt(pair, 16));
}
function concat(...parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function word(value) {
  return bytesFromHex(value.toString(16).padStart(64, "0"));
}
function address(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error("invalid-factory-configuration");
  return bytesFromHex(value.slice(2));
}

export function counterfactualPasskeyAddress({ ownerPublicKey, nonce, factory, implementation }) {
  if (!(ownerPublicKey instanceof Uint8Array) || ownerPublicKey.length !== 65 || ownerPublicKey[0] !== 4) {
    throw new Error("invalid-passkey-public-key");
  }
  try { p256.Point.fromBytes(ownerPublicKey).assertValidity(); }
  catch { throw new Error("invalid-passkey-public-key"); }
  if (typeof nonce !== "bigint" || nonce < 0n || nonce > MAX_UINT256) throw new Error("invalid-account-nonce");
  const factoryBytes = address(factory);
  const implementationBytes = address(implementation);
  // abi.encode(bytes[] owners, uint256 nonce), one uncompressed P-256 X || Y owner.
  const encoded = concat(word(64n), word(nonce), word(1n), word(32n), word(64n), ownerPublicKey.slice(1));
  const salt = keccak_256(encoded);
  const initHash = keccak_256(concat(bytesFromHex(PREFIX), implementationBytes, bytesFromHex(SUFFIX)));
  const raw = keccak_256(concat(Uint8Array.of(255), factoryBytes, salt, initHash)).slice(12);
  return checksumAddress(`0x${Array.from(raw, (byte) => byte.toString(16).padStart(2, "0")).join("")}`);
}

// An explicit, unbound candidate only: a verified login proves this key was
// used for this link, not that it controls an existing Principal or wallet.
// The caller must supply the pinned account parameters rather than deriving
// them from a DID or guessing another product's Principal mapping.
export function candidateFromPasskeyLink({ request, response, deviceDid, now, atLink, nonce, factory, implementation }) {
  const account = verifyLink({ request, response, deviceDid, now, atLink });
  if (account.method !== "passkey") throw new Error("passkey-required");
  const ownerPublicKey = p256.Point.fromBytes(fromBase64Url(response.publicKey)).toBytes(false);
  const address = counterfactualPasskeyAddress({ ownerPublicKey, nonce, factory, implementation });
  return Object.freeze({ identityDid: account.accountDid, address, status: "unbound-candidate" });
}
