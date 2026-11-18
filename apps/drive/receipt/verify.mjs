// Verify the signed storage receipt a yataverse.com Drive pack upload returns (AWAI-3314).
// The receipt format is app-itonami-yataverse docs/storage-receipt-design.md (YataverseStorageReceipt
// v1): EIP-712 typed data signed with Ed25519 over the EIP-712 digest. This is an independent port
// of that repo's src/receipt.mjs `verifyReceipt`, limited to what a Drive pack receipt must say.
// Bundled to generated/receipt.js (scripts/bundle.mjs); keys are pinned at build time
// (receipt-trust.json), so no key fetch or extra consent happens at run time.
import { keccak_256 } from '@noble/hashes/sha3';
import { sha256 } from '@noble/hashes/sha2';
import { ed25519 } from '@noble/curves/ed25519';

const FIELDS = [
  ['kind', 'uint8'], ['subject', 'bytes'], ['size', 'uint64'], ['contentDigest', 'bytes32'],
  ['requestId', 'bytes32'], ['requester', 'bytes32'], ['reservationId', 'bytes32'], ['leaseId', 'bytes32'],
  ['pieceCommitment', 'bytes32'], ['policyRevision', 'bytes32'], ['state', 'uint8'], ['storeClass', 'uint8'],
  ['acceptedAt', 'uint64'], ['retentionUntil', 'uint64'], ['keyId', 'bytes32'], ['keyEpoch', 'uint32'],
];
const enc = new TextEncoder();
const fail = (code) => { throw Error(`receipt-${code}`); };
const typeHash = (s) => keccak_256(enc.encode(s));
const RECEIPT_TYPE_HASH = typeHash(`YataverseStorageReceipt(${FIELDS.map(([n, t]) => `${t} ${n}`).join(',')})`);
// Domain {name, version}: no chainId until the Awai L1 chain id exists (owner decision 2026-11-18).
const DOMAIN_SEPARATOR = keccak_256(concat([typeHash('EIP712Domain(string name,string version)'),
  keccak_256(enc.encode('Awai Yataverse Storage Receipt')), keccak_256(enc.encode('1'))]));
const ZERO32 = new Uint8Array(32);
const KIND_DRIVE_PACK = 3, STATE_LOCAL_DURABLE_READBACK = 1, STORE_CLASSES = [1, 2];

function concat(parts) { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
function fromHex(s, len, field) {
  if (typeof s !== 'string' || !/^0x(?:[0-9a-f]{2})*$/.test(s) || (len !== undefined && s.length !== 2 + 2 * len)) fail(`bad-${field}`);
  return Uint8Array.from(s.slice(2).match(/../g) ?? [], (h) => parseInt(h, 16));
}
function fromB64url(s, field) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]+$/.test(s)) fail(`bad-${field}`);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function uintWord(v, bits, field) {
  if (!Number.isSafeInteger(v) || v < 0 || BigInt(v) >= 1n << BigInt(bits)) fail(`bad-${field}`);
  const out = new Uint8Array(32); let x = BigInt(v);
  for (let i = 31; x > 0n; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}

/** JSON receipt fields -> typed values (bytes as Uint8Array). Exactly the v1 field set. */
export function parseFields(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) fail('not-an-object');
  const keys = Object.keys(j);
  if (keys.length !== FIELDS.length || FIELDS.some(([n]) => !Object.hasOwn(j, n))) fail('fields-do-not-match');
  const r = {};
  for (const [n, t] of FIELDS) {
    if (t.startsWith('uint')) { uintWord(j[n], Number(t.slice(4)), n); r[n] = j[n]; }
    else r[n] = fromHex(j[n], t === 'bytes32' ? 32 : undefined, n);
  }
  if (r.subject.length < 1 || r.subject.length > 128) fail('bad-subject');
  return r;
}

/** The EIP-712 digest keccak256(0x1901 || domainSeparator || hashStruct(receipt)). */
export function receiptDigest(r) {
  const words = [RECEIPT_TYPE_HASH];
  for (const [n, t] of FIELDS) {
    if (t === 'bytes') words.push(keccak_256(r[n]));
    else if (t === 'bytes32') words.push(r[n]);
    else words.push(uintWord(r[n], Number(t.slice(4)), n));
  }
  return keccak_256(concat([Uint8Array.of(0x19, 0x01), DOMAIN_SEPARATOR, keccak_256(concat(words))]));
}

export const keyIdFor = (publicKey) => sha256(concat([Uint8Array.of(0xed, 0x01), publicKey]));

/**
 * Check the receipt in a Drive pack upload response against the pinned key set and the pack
 * this device sent (id = sha256 hex, size in bytes). -> { keyId, keyEpoch, acceptedAt }.
 * Throws Error('receipt-...') on anything else.
 */
export function verifyDrivePackReceipt(response, keys, { id, size }) {
  const env = response?.receipt;
  if (!env || env.v !== 1 || !env.receipt || !env.sig) fail('missing');
  if (env.sig.alg !== 'Ed25519') fail('unsupported-algorithm');
  const r = parseFields(env.receipt);
  const sig = fromB64url(env.sig.sig, 'signature');
  if (sig.length !== 64) fail('bad-signature');
  if (!same(fromHex(env.sig.key, 32, 'sig-key'), r.keyId)) fail('signature-key-is-not-receipt-key');
  // The key: pinned, same epoch, valid at acceptedAt and not revoked by then.
  const entry = (keys?.keys ?? []).find((k) => k.keyId === '0x' + toHex(r.keyId));
  if (!entry) fail('unknown-key');
  if (entry.alg !== 'Ed25519' || entry.publicKeyJwk?.kty !== 'OKP' || entry.publicKeyJwk?.crv !== 'Ed25519') fail('bad-pinned-key');
  const publicKey = fromB64url(entry.publicKeyJwk.x, 'pinned-key');
  if (publicKey.length !== 32 || !same(keyIdFor(publicKey), r.keyId)) fail('pinned-key-does-not-match-key-id');
  if (entry.keyEpoch !== r.keyEpoch) fail('key-epoch-mismatch');
  if (!(r.acceptedAt >= entry.notBefore)) fail('accepted-before-key-valid');
  if (entry.notAfter != null && !(r.acceptedAt < entry.notAfter)) fail('accepted-after-key-expired');
  if (entry.revokedAt != null && !(r.acceptedAt < entry.revokedAt)) fail('key-revoked');
  let ok = false;
  try { ok = ed25519.verify(sig, receiptDigest(r), publicKey); } catch { ok = false; }
  if (!ok) fail('bad-signature');
  // What this device sent: an unauthenticated Drive pack whose id is its SHA-256.
  if (!/^[a-f0-9]{64}$/.test(id)) fail('bad-expected-id');
  const digest = fromHex('0x' + id, 32, 'expected-id');
  if (r.kind !== KIND_DRIVE_PACK) fail('kind-mismatch');
  if (!same(r.subject, digest)) fail('subject-mismatch');
  if (!same(r.contentDigest, digest)) fail('contentDigest-mismatch');
  if (r.size !== size) fail('size-mismatch');
  if (!same(r.requestId, digest)) fail('requestId-mismatch');           // Drive sends no request id
  if (!same(r.requester, ZERO32)) fail('requester-mismatch');           // nor credentials
  // What an entry gateway may claim: stored and read back, nothing more.
  if (r.state !== STATE_LOCAL_DURABLE_READBACK) fail(r.state === 10 ? 'gateway-claims-policy-satisfied' : 'unknown-state');
  if (!STORE_CLASSES.includes(r.storeClass)) fail('unknown-store-class');
  return { keyId: '0x' + toHex(r.keyId), keyEpoch: r.keyEpoch, acceptedAt: r.acceptedAt };
}
