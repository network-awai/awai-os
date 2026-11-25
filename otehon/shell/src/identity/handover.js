// awai.handover.v1: add a new Android device from an existing iOS/Android
// Awai account (AWAI-4071, concretizes AWAI-3004 / docs/otehon/android-shared-setup.md).
//
// The short-lived challenge binds the new device public key (did:key), device
// name, expiry and selected profile scope. QR or cross-device Passkey
// approval does NOT itself copy a profile or private credential: the profile
// transfer after approval is a separate encrypted envelope sealed for the
// new device's ephemeral P-256 key (same construction as awai.link.v1
// responses: ECDH + HKDF + AES-GCM).
//
// No seed, device PIN, wallet private key or owner authentication material
// is ever copied. The device signing key is non-exportable P-256 (WebCrypto,
// same custody as device.js; Android Keystore mirror in HandoverKeys.java).
// Where a selected scope has no provider wired in this build, the transfer
// reports truthful unavailable/defer instead of fabricating restored state.
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  p256Did,
  compressP256,
  toBase64Url,
  fromBase64Url,
  REQUEST_MS,
} from "./link.js";

export const HANDOVER_SCHEMA = "awai.handover.v1";
export const HANDOVER_TTL_MS = REQUEST_MS; // 10 minutes, same as link request
const DEVICE_NAME_MAX = 64;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const ALLOWED_SCOPES = [
  "profile:settings",
  "profile:home-state",
  "profile:wnfs-snapshot",
  "profile:yotei-events",
];
const IMPLEMENTED_SCOPES = ["profile:settings", "profile:home-state"];

const FORBIDDEN_KEYS = [
  "privateKey",
  "private_key",
  "seed",
  "mnemonic",
  "pin",
  "password",
  "secret",
  "walletPrivateKey",
  "ownerKey",
  "credential",
];

const DID_RE = /^did:key:z[1-9A-HJ-NP-Za-km-z]{20,110}$/;
const TOPIC_RE = /^[0-9a-f]{32}$/;
const NONCE_RE = /^[0-9a-f]{24}$/;

function isDeviceName(name) {
  return (
    typeof name === "string" &&
    name.length >= 1 &&
    name.length <= DEVICE_NAME_MAX &&
    name.trim().length >= 1 &&
    Array.from(name).every((c) => c.codePointAt(0) >= 32)
  );
}

function isDid(did) {
  return typeof did === "string" && DID_RE.test(did);
}

function isScope(scope) {
  return ALLOWED_SCOPES.includes(scope);
}

function validScopeVector(scope) {
  return (
    Array.isArray(scope) &&
    scope.length >= 1 &&
    scope.length <= 8 &&
    scope.every(isScope) &&
    new Set(scope).size === scope.length
  );
}

export function transferStatus(scope) {
  if (!validScopeVector(scope)) return "unavailable";
  return scope.every((s) => IMPLEMENTED_SCOPES.includes(s)) ? "ready" : "unavailable";
}

export function hasForbiddenKey(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  return FORBIDDEN_KEYS.some((k) => Object.hasOwn(obj, k));
}

export function validChallenge(challenge) {
  if (!challenge || typeof challenge !== "object") return false;
  return (
    challenge.schema === HANDOVER_SCHEMA &&
    isDid(challenge.device) &&
    isDeviceName(challenge.deviceName) &&
    typeof challenge.nonce === "string" &&
    NONCE_RE.test(challenge.nonce) &&
    typeof challenge.topic === "string" &&
    TOPIC_RE.test(challenge.topic) &&
    typeof challenge.ek === "string" &&
    challenge.ek.length > 0 &&
    typeof challenge.exp === "string" &&
    Number.isFinite(Date.parse(challenge.exp)) &&
    validScopeVector(challenge.scope) &&
    typeof challenge.sig === "string" &&
    challenge.sig.length > 0
  );
}

const randomHex = (size) => toHex(crypto.getRandomValues(new Uint8Array(size)));

// Canonical challenge text signed by the device key. Binds every field the
// approving phone displays: device pubkey, device name, expiry, scope, nonce,
// topic and the ephemeral encryption key.
export function handoverChallengeText(challenge) {
  const scopeText = Array.isArray(challenge.scope) ? [...challenge.scope].sort().join(",") : "";
  return [
    HANDOVER_SCHEMA,
    challenge.device,
    challenge.deviceName,
    challenge.exp,
    scopeText,
    challenge.nonce,
    challenge.topic,
    challenge.ek,
  ].join("\n");
}

// Device calls this. The challenge carries a fresh ephemeral ECDH key for the
// later profile-envelope encryption and a signature from the new device's
// non-exportable P-256 signing key, so the phone verifies key possession.
export async function createHandoverChallenge(deviceDid, deviceName, scope, now = Date.now(), devicePair) {
  if (!isDid(deviceDid)) throw new Error("invalid-challenge");
  if (!isDeviceName(deviceName)) throw new Error("invalid-challenge");
  if (!validScopeVector(scope)) throw new Error("invalid-challenge");
  if (!devicePair?.privateKey || !devicePair?.publicKey) throw new Error("device-key-unavailable");

  // Verify the supplied pair is a non-exportable P-256 device key holding
  // the claimed DID (same checks as device.js verifyDeviceKeyPair).
  const key = devicePair.privateKey;
  if (
    key.type !== "private" ||
    key.extractable !== false ||
    key.algorithm?.name !== "ECDSA" ||
    key.algorithm?.namedCurve !== "P-256" ||
    !key.usages.includes("sign")
  ) {
    throw new Error("device-key-unavailable");
  }
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", devicePair.publicKey));
  if (p256Did(compressP256(rawPub)) !== deviceDid) throw new Error("wrong-device");

  // Possession check: sign a random challenge, verify locally.
  const probe = crypto.getRandomValues(new Uint8Array(32));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, probe);
  const verifier = await crypto.subtle.importKey(
    "raw",
    rawPub,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifier, sig, probe);
  if (!ok) throw new Error("device-key-mismatch");

  // Fresh ephemeral ECDH key for the later profile envelope.
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const challenge = {
    schema: HANDOVER_SCHEMA,
    device: deviceDid,
    deviceName,
    nonce: randomHex(12),
    topic: randomHex(16),
    ek: toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
    exp: new Date(now + HANDOVER_TTL_MS).toISOString(),
    scope: [...scope].sort(),
    sig: "",
  };
  const text = handoverChallengeText(challenge);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, devicePair.privateKey, encoder.encode(text));
  challenge.sig = toBase64Url(new Uint8Array(signature));
  return { challenge, ephemeralPrivateKey: pair.privateKey };
}

// Phone (or new device, for display) verifies the device-key signature and
// the binding fields. Throws with a reason or returns the verified fields.
export async function verifyHandoverChallenge(challenge, { deviceDid, approvedScope, now = Date.now(), revoked = new Set(), cancelled = false } = {}) {
  if (cancelled) throw new Error("cancelled");
  if (!validChallenge(challenge)) throw new Error("invalid-challenge");
  if (deviceDid !== undefined && challenge.device !== deviceDid) throw new Error("wrong-device");
  if (Date.parse(challenge.exp) <= now) throw new Error("expired");
  if (revoked.has(challenge.device)) throw new Error("revoked");
  if (approvedScope !== undefined) {
    if (!validScopeVector(approvedScope)) throw new Error("scope-not-approved");
    const approved = new Set(approvedScope);
    if (!challenge.scope.every((s) => approved.has(s))) throw new Error("scope-not-approved");
  }
  // Device-key possession: verify challenge.sig with the claimed DID's key.
  // The verifier needs the device public key from the caller; the challenge
  // DID itself does not carry it, so the caller must supply devicePublicKey.
  return { device: challenge.device, deviceName: challenge.deviceName, scope: challenge.scope, expiresAt: challenge.exp };
}

export async function verifyHandoverChallengeWithKey(challenge, devicePublicKeyRaw, opts = {}) {
  const out = await verifyHandoverChallenge(challenge, opts);
  // devicePublicKeyRaw: 65-byte raw P-256 uncompressed.
  if (!devicePublicKeyRaw || devicePublicKeyRaw.length !== 65) throw new Error("invalid-challenge");
  if (p256Did(compressP256(devicePublicKeyRaw)) !== challenge.device) throw new Error("wrong-device");
  const key = await crypto.subtle.importKey(
    "raw",
    devicePublicKeyRaw,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    fromBase64Url(challenge.sig),
    encoder.encode(handoverChallengeText(challenge)),
  );
  if (!ok) throw new Error("invalid-signature");
  return { ...out, status: transferStatus(challenge.scope) };
}

export function handoverConfirmationCode(challenge) {
  const digest = toHex(sha256(encoder.encode(JSON.stringify(challenge)))).toUpperCase();
  return `${digest.slice(0, 3)}-${digest.slice(3, 6)}`;
}

const handoverInfo = (challenge) => `awai.handover.v1 ${challenge.topic}`;

async function sessionKey(privateKey, peerRaw, challenge) {
  const peer = await crypto.subtle.importKey("raw", peerRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, privateKey, 256);
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode(challenge.nonce), info: encoder.encode(handoverInfo(challenge)) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const envelopeAad = (challenge) => encoder.encode(`${challenge.device} ${challenge.exp} ${challenge.scope.join(",")}`);

// Phone calls this after approval. Payload must be the selected-profile data
// only; it must not contain a forbidden credential field.
export async function sealProfileTransfer(challenge, profilePayload) {
  if (!validChallenge(challenge)) throw new Error("invalid-challenge");
  if (!profilePayload || typeof profilePayload !== "object" || Array.isArray(profilePayload)) {
    throw new Error("invalid-payload");
  }
  if (hasForbiddenKey(profilePayload)) throw new Error("forbidden-field");
  const status = transferStatus(challenge.scope);
  if (status !== "ready") throw new Error("profile-transfer-unavailable");

  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const key = await sessionKey(pair.privateKey, fromBase64Url(challenge.ek), challenge);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: envelopeAad(challenge) },
    key,
    encoder.encode(JSON.stringify(profilePayload)),
  );
  return JSON.stringify({
    schema: HANDOVER_SCHEMA,
    device: challenge.device,
    scope: challenge.scope,
    exp: challenge.exp,
    ek: toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
    iv: toBase64Url(iv),
    ct: toBase64Url(new Uint8Array(ciphertext)),
  });
}

// New device calls this with the ephemeral private key from
// createHandoverChallenge. Only the matching device can open it.
export async function openProfileTransfer(challenge, ephemeralPrivateKey, sealed) {
  try {
    const envelope = JSON.parse(sealed);
    if (
      envelope.schema !== HANDOVER_SCHEMA ||
      envelope.device !== challenge.device ||
      JSON.stringify(envelope.scope) !== JSON.stringify(challenge.scope) ||
      envelope.exp !== challenge.exp
    ) {
      throw new Error("invalid-envelope");
    }
    const key = await sessionKey(ephemeralPrivateKey, fromBase64Url(envelope.ek), challenge);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(envelope.iv), additionalData: envelopeAad(challenge) },
      key,
      fromBase64Url(envelope.ct),
    );
    const payload = JSON.parse(decoder.decode(plain));
    if (hasForbiddenKey(payload)) throw new Error("forbidden-field");
    return payload;
  } catch (e) {
    if (e?.message === "forbidden-field" || e?.message === "invalid-envelope") throw e;
    throw new Error("cannot-decrypt");
  }
}
