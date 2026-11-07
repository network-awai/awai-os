// awai.link.v1: link a device to an account with a phone (ADR 0026 D13).
// The device and the phone run this same code. The relay carries ciphertext only.
import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

export const LINK_ORIGIN = "https://awai.network";
export const RP_ID = "awai.network";
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const REQUEST_MS = 10 * 60 * 1000;
const SKEW_MS = 5 * 60 * 1000;
const SIWE_STATEMENT = "Link this device to your Awai account:";
const P256_MULTICODEC = [0x80, 0x24];
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function fromBase64Url(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("invalid-encoding");
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const toHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

function fromHex(text) {
  if (!/^(?:[0-9a-f]{2})*$/.test(text)) throw new Error("invalid-encoding");
  return Uint8Array.from(text.match(/../g) ?? [], (byte) => parseInt(byte, 16));
}

function base58(bytes) {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let out = "";
  while (value > 0n) {
    out = BASE58[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

// did:key for a compressed P-256 public key.
export function p256Did(compressedKey) {
  if (compressedKey.length !== 33) throw new Error("invalid-public-key");
  return `did:key:z${base58(Uint8Array.from([...P256_MULTICODEC, ...compressedKey]))}`;
}

export function compressP256(rawKey) {
  return p256.Point.fromBytes(rawKey).toBytes(true);
}

export function checksumAddress(address) {
  const lower = address.toLowerCase().replace(/^0x/, "");
  const hash = toHex(keccak_256(encoder.encode(lower)));
  let out = "0x";
  for (let i = 0; i < lower.length; i += 1) {
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

const randomHex = (size) => toHex(crypto.getRandomValues(new Uint8Array(size)));

function validRequest(request) {
  return (
    request !== null &&
    typeof request === "object" &&
    request.v === 1 &&
    /^did:key:z[1-9A-HJ-NP-Za-km-z]+$/.test(request.device) &&
    /^[0-9a-f]{32}$/.test(request.topic) &&
    /^[0-9a-f]{24}$/.test(request.nonce) &&
    typeof request.ek === "string" &&
    Number.isFinite(Date.parse(request.exp))
  );
}

// The device calls this. The private half stays in this browser's memory.
export async function createLinkRequest(deviceDid, now = Date.now()) {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const request = {
    v: 1,
    device: deviceDid,
    topic: randomHex(16),
    nonce: randomHex(12),
    ek: toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
    exp: new Date(now + REQUEST_MS).toISOString(),
  };
  return { request, privateKey: pair.privateKey };
}

export function linkUrl(request, origin = LINK_ORIGIN) {
  return `${origin}/link/#${toBase64Url(encoder.encode(JSON.stringify(request)))}`;
}

export function parseLinkFragment(fragment, now = Date.now()) {
  let request;
  try {
    request = JSON.parse(decoder.decode(fromBase64Url(fragment.replace(/^#/, ""))));
  } catch {
    throw new Error("invalid-request");
  }
  if (!validRequest(request)) throw new Error("invalid-request");
  if (Date.parse(request.exp) <= now) throw new Error("request-expired");
  return request;
}

// Both screens show this code, so a person can notice a QR code from another device.
export function confirmationCode(request) {
  const digest = toHex(sha256(encoder.encode(JSON.stringify(request)))).toUpperCase();
  return `${digest.slice(0, 3)}-${digest.slice(3, 6)}`;
}

async function sessionKey(privateKey, peerRaw, request) {
  const peer = await crypto.subtle.importKey("raw", peerRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, privateKey, 256);
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(request.nonce),
      info: encoder.encode(`awai.link.v1 ${request.topic}`),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const aad = (request) => encoder.encode(`${request.device} ${request.exp}`);

// The phone calls this. The relay sees only the returned text.
export async function sealResponse(request, response) {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const key = await sessionKey(pair.privateKey, fromBase64Url(request.ek), request);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(request) },
    key,
    encoder.encode(JSON.stringify(response)),
  );
  return toBase64Url(
    encoder.encode(
      JSON.stringify({
        ek: toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
        iv: toBase64Url(iv),
        ct: toBase64Url(new Uint8Array(ciphertext)),
      }),
    ),
  );
}

export async function openResponse(request, privateKey, sealed) {
  try {
    const { ek, iv, ct } = JSON.parse(decoder.decode(fromBase64Url(sealed)));
    const key = await sessionKey(privateKey, fromBase64Url(ek), request);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(iv), additionalData: aad(request) },
      key,
      fromBase64Url(ct),
    );
    return JSON.parse(decoder.decode(plain));
  } catch {
    throw new Error("cannot-decrypt");
  }
}

export function siweMessage({ address, chainId, device, nonce, issuedAt, expiresAt }) {
  return [
    `${RP_ID} wants you to sign in with your Ethereum account:`,
    address,
    "",
    `${SIWE_STATEMENT} ${device}`,
    "",
    `URI: ${LINK_ORIGIN}/link/`,
    "Version: 1",
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expiresAt}`,
  ].join("\n");
}

export function personalMessageHash(message) {
  const body = encoder.encode(message);
  const prefix = encoder.encode(`\x19Ethereum Signed Message:\n${body.length}`);
  return keccak_256(Uint8Array.from([...prefix, ...body]));
}

export function passkeyChallenge({ device, nonce, expiresAt }) {
  return sha256(encoder.encode(`awai.link.v1\n${device}\n${nonce}\n${expiresAt}`));
}

function checkWindow(response, request, now, atLink) {
  const expiresAt = Date.parse(response.expiresAt);
  if (!Number.isFinite(expiresAt)) throw new Error("invalid-response");
  if (expiresAt <= now) throw new Error("session-expired");
  if (atLink) {
    if (Date.parse(request.exp) <= now) throw new Error("request-expired");
    if (expiresAt > now + SESSION_MS + SKEW_MS) throw new Error("session-too-long");
  }
}

// Recovers the address that signed a personal_sign message, or throws.
export function recoverAddress(message, signature) {
  if (typeof signature !== "string" || !/^0x[0-9a-f]{130}$/i.test(signature)) throw new Error("invalid-signature");
  const bytes = fromHex(signature.slice(2).toLowerCase());
  const v = bytes[64] >= 27 ? bytes[64] - 27 : bytes[64];
  if (v !== 0 && v !== 1) throw new Error("invalid-signature");
  let recovered;
  try {
    const compact = Uint8Array.from([v, ...bytes.slice(0, 64)]);
    recovered = secp256k1.recoverPublicKey(compact, personalMessageHash(message), { prehash: false });
  } catch {
    throw new Error("invalid-signature");
  }
  const uncompressed = secp256k1.Point.fromBytes(recovered).toBytes(false);
  return checksumAddress(`0x${toHex(keccak_256(uncompressed.slice(1))).slice(-40)}`);
}

function verifyWallet(response, request) {
  const { address, chainId, issuedAt, expiresAt, signature } = response;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || checksumAddress(address) !== address) {
    throw new Error("invalid-address");
  }
  if (!Number.isSafeInteger(chainId) || chainId < 1) throw new Error("invalid-response");
  if (!Number.isFinite(Date.parse(issuedAt))) throw new Error("invalid-response");
  if (Date.parse(expiresAt) - Date.parse(issuedAt) > SESSION_MS) throw new Error("session-too-long");
  const message = siweMessage({ address, chainId, device: request.device, nonce: request.nonce, issuedAt, expiresAt });
  if (recoverAddress(message, signature) !== address) throw new Error("wrong-signer");
  return `did:pkh:eip155:${chainId}:${address}`;
}

function verifyPasskey(response, request) {
  const { publicKey, authenticatorData, clientDataJSON, signature, expiresAt } = response;
  const key = fromBase64Url(publicKey);
  const accountDid = p256Did(key);
  const dataBytes = fromBase64Url(clientDataJSON);
  const authBytes = fromBase64Url(authenticatorData);
  let client;
  try {
    client = JSON.parse(decoder.decode(dataBytes));
  } catch {
    throw new Error("invalid-response");
  }
  if (client.type !== "webauthn.get") throw new Error("wrong-ceremony");
  if (client.origin !== LINK_ORIGIN) throw new Error("wrong-origin");
  const expected = toBase64Url(passkeyChallenge({ device: request.device, nonce: request.nonce, expiresAt }));
  if (client.challenge !== expected) throw new Error("wrong-challenge");
  if (authBytes.length < 37) throw new Error("invalid-response");
  if (toHex(authBytes.slice(0, 32)) !== toHex(sha256(encoder.encode(RP_ID)))) throw new Error("wrong-rp");
  const flags = authBytes[32];
  if ((flags & 0x01) === 0 || (flags & 0x04) === 0) throw new Error("no-user-verification");
  const signed = sha256(Uint8Array.from([...authBytes, ...sha256(dataBytes)]));
  let valid = false;
  try {
    valid = p256.verify(fromBase64Url(signature), signed, key, { prehash: false, lowS: false, format: "der" });
  } catch {
    valid = false;
  }
  if (!valid) throw new Error("invalid-signature");
  return accountDid;
}

// Throws with a reason, or returns the account this proof links the device to.
// atLink adds the checks that apply only when the phone's answer first arrives.
export function verifyLink({ request, response, deviceDid, now = Date.now(), atLink = true }) {
  if (!validRequest(request) || response === null || typeof response !== "object") {
    throw new Error("invalid-response");
  }
  if (request.device !== deviceDid) throw new Error("wrong-device");
  checkWindow(response, request, now, atLink);
  let accountDid;
  if (response.method === "wallet") accountDid = verifyWallet(response, request);
  else if (response.method === "passkey") accountDid = verifyPasskey(response, request);
  else throw new Error("unknown-method");
  return { accountDid, method: response.method, expiresAt: response.expiresAt };
}
