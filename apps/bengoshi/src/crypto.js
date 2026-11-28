// Client-side E2EE envelope (bengoshi.e2ee.envelope.v1) for Bengoshi (O8).
// Hybrid RSA-OAEP-256 + AES-256-GCM encryption via standard Web Crypto API.
// All encryption and decryption happen strictly on the user's or lawyer's device;
// plaintext is never exposed to relay infrastructure or app origin.

const ENVELOPE_SCHEMA = 'bengoshi.e2ee.envelope.v1';
const ENVELOPE_ALG = 'RSA-OAEP-256+A256GCM';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function getSubtle() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('webcrypto-unavailable');
  return subtle;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64) {
  if (typeof b64 !== 'string' || !b64.length) throw new TypeError('invalid-base64');
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

function canonicalAadBytes(recipientLawyerId, conflictHeader) {
  const aadObj = {
    schema: ENVELOPE_SCHEMA,
    recipientLawyerId: String(recipientLawyerId || ''),
    conflictHeader: {
      inquiryId: String(conflictHeader?.inquiryId || ''),
      clientName: String(conflictHeader?.clientName || ''),
      counterpartyName: String(conflictHeader?.counterpartyName || ''),
      category: String(conflictHeader?.category || ''),
    },
  };
  return encoder.encode(JSON.stringify(aadObj));
}

export async function generateLawyerKeyPair() {
  const subtle = getSubtle();
  const keyPair = await subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  );
  const publicKeyJwk = await subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyJwk = await subtle.exportKey('jwk', keyPair.privateKey);
  const keyFingerprint = toHex(await subtle.digest('SHA-256', encoder.encode(JSON.stringify({ kty: publicKeyJwk.kty, n: publicKeyJwk.n, e: publicKeyJwk.e }))));
  return {
    alg: 'RSA-OAEP-256',
    keyFingerprint,
    publicKeyJwk,
    privateKeyJwk,
  };
}

export async function encryptEnvelope({ plaintext, recipientPublicKeyJwk, recipientLawyerId, conflictHeader }) {
  if (!plaintext || typeof plaintext !== 'object') throw new TypeError('plaintext-object-required');
  if (!recipientPublicKeyJwk || typeof recipientPublicKeyJwk !== 'object') throw new TypeError('recipient-public-key-required');
  if (typeof recipientLawyerId !== 'string' || !recipientLawyerId.trim()) throw new TypeError('recipient-lawyer-id-required');

  const subtle = getSubtle();
  const rsaPublicKey = await subtle.importKey(
    'jwk',
    recipientPublicKeyJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );

  const cek = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const rawCek = new Uint8Array(await subtle.exportKey('raw', cek));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const aad = canonicalAadBytes(recipientLawyerId, conflictHeader);
  const aadSha256 = toHex(await subtle.digest('SHA-256', aad));

  const plainBytes = encoder.encode(JSON.stringify(plaintext));
  const cipherBuf = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, cek, plainBytes);
  const wrappedKeyBuf = await subtle.encrypt({ name: 'RSA-OAEP' }, rsaPublicKey, rawCek);

  // Zero ephemeral raw key buffer best-effort
  rawCek.fill(0);

  return Object.freeze({
    schema: ENVELOPE_SCHEMA,
    alg: ENVELOPE_ALG,
    recipientLawyerId,
    conflictHeader: Object.freeze({
      inquiryId: String(conflictHeader?.inquiryId || ''),
      clientName: String(conflictHeader?.clientName || ''),
      counterpartyName: String(conflictHeader?.counterpartyName || ''),
      category: String(conflictHeader?.category || ''),
      receivedAt: String(conflictHeader?.receivedAt || new Date().toISOString()),
    }),
    wrappedKeyB64: bytesToBase64(new Uint8Array(wrappedKeyBuf)),
    ivB64: bytesToBase64(iv),
    ciphertextB64: bytesToBase64(new Uint8Array(cipherBuf)),
    aadSha256,
    createdAt: new Date().toISOString(),
  });
}

export async function decryptEnvelope({ envelope, recipientPrivateKeyJwk }) {
  if (!envelope || envelope.schema !== ENVELOPE_SCHEMA || envelope.alg !== ENVELOPE_ALG) {
    throw new TypeError('invalid-e2ee-envelope');
  }
  if (!recipientPrivateKeyJwk || typeof recipientPrivateKeyJwk !== 'object') {
    throw new TypeError('recipient-private-key-required');
  }

  const subtle = getSubtle();
  const rsaPrivateKey = await subtle.importKey(
    'jwk',
    recipientPrivateKeyJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  );

  const wrappedKey = base64ToBytes(envelope.wrappedKeyB64);
  const rawCek = new Uint8Array(await subtle.decrypt({ name: 'RSA-OAEP' }, rsaPrivateKey, wrappedKey));
  const cek = await subtle.importKey('raw', rawCek, { name: 'AES-GCM' }, false, ['decrypt']);
  rawCek.fill(0);

  const iv = base64ToBytes(envelope.ivB64);
  const ciphertext = base64ToBytes(envelope.ciphertextB64);
  const aad = canonicalAadBytes(envelope.recipientLawyerId, envelope.conflictHeader);
  const aadSha256 = toHex(await subtle.digest('SHA-256', aad));
  if (aadSha256 !== envelope.aadSha256) {
    throw new Error('e2ee-aad-mismatch');
  }

  const plainBuf = await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, cek, ciphertext);
  return JSON.parse(decoder.decode(new Uint8Array(plainBuf)));
}

export function verifyEnvelopeHasNoPlaintext(envelope, secretStrings = []) {
  const serialized = JSON.stringify({
    wrappedKeyB64: envelope?.wrappedKeyB64 || '',
    ivB64: envelope?.ivB64 || '',
    ciphertextB64: envelope?.ciphertextB64 || '',
    aadSha256: envelope?.aadSha256 || '',
  });
  for (const s of secretStrings) {
    if (typeof s === 'string' && s.trim().length >= 4 && serialized.includes(s.trim())) {
      return { ok: false, leaked: s.trim() };
    }
  }
  return { ok: true, leaked: null };
}
