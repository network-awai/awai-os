// Drive's storage receipt check (AWAI-3314), run against the shipped bundle generated/receipt.js.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519';
import { verifyDrivePackReceipt, receiptDigest, parseFields, keyIdFor } from '../generated/receipt.js';
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const REAL = read('./fixtures/yataverse-pack-receipt-20261118.json');
const META = read('./fixtures/yataverse-pack-receipt-20261118.meta.json');
const TRUST = read('../receipt-trust.json')['https://yataverse.com'];
const hex = (b) => '0x' + Buffer.from(b).toString('hex');
const b64url = (b) => Buffer.from(b).toString('base64url');
const rejects = (fn, code) => assert.throws(fn, (e) => e.message === `receipt-${code}`, code);

// A throwaway key that signs receipts with chosen fields, and the key set that pins it.
const sk = ed25519.utils.randomPrivateKey(), pk = ed25519.getPublicKey(sk), kid = hex(keyIdFor(pk));
const pinned = (extra = {}) => ({ v: 1, signer: 'did:web:yataverse.com', keys: [{ keyId: kid, keyEpoch: 1, alg: 'Ed25519',
  publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: b64url(pk) }, notBefore: 0, notAfter: null, revokedAt: null, ...extra }] });
const id = 'ab'.repeat(32), size = 4096;
function signed(over = {}) {
  const receipt = { kind: 3, subject: '0x' + id, size, contentDigest: '0x' + id, requestId: '0x' + id, requester: hex(new Uint8Array(32)),
    reservationId: hex(new Uint8Array(32)), leaseId: hex(new Uint8Array(32)), pieceCommitment: hex(new Uint8Array(32)),
    policyRevision: hex(new Uint8Array(32).fill(7)), state: 1, storeClass: 1, acceptedAt: 1000, retentionUntil: 0, keyId: kid, keyEpoch: 1, ...over };
  return { sha256: id, bytes: size, receipt: { v: 1, receipt, sig: { alg: 'Ed25519', key: kid, sig: b64url(ed25519.sign(receiptDigest(parseFields(receipt)), sk)) } } };
}

test('the EIP-712 digest matches the viem oracle vector recorded in app-itonami-yataverse', () => {
  const vector = { kind: 3, subject: '0xb327551a00000000000000000000000000000000000000000000000000007320', size: 12494,
    contentDigest: '0xb327551a00000000000000000000000000000000000000000000000000007320', requestId: '0xb327551a00000000000000000000000000000000000000000000000000007320',
    requester: hex(new Uint8Array(32)), reservationId: hex(new Uint8Array(32)), leaseId: hex(new Uint8Array(32)), pieceCommitment: hex(new Uint8Array(32)),
    policyRevision: '0x' + '11'.repeat(32), state: 1, storeClass: 1, acceptedAt: 1795046400000, retentionUntil: 0, keyId: '0x' + '22'.repeat(32), keyEpoch: 1 };
  assert.equal(hex(receiptDigest(parseFields(vector))), '0x0e99111ec7716683f80460a9e79243824830ba37dbe3d2ee3b9a9d4b31c0e3a9');
});

test('a real yataverse.com pack receipt verifies against the pinned key and the pack sent', () => {
  const r = verifyDrivePackReceipt(REAL, TRUST, { id: META.id, size: META.size });
  assert.equal(r.keyId, TRUST.keys[0].keyId); assert.equal(r.keyEpoch, 1);
  rejects(() => verifyDrivePackReceipt(REAL, TRUST, { id: 'cd'.repeat(32), size: META.size }), 'subject-mismatch');
  rejects(() => verifyDrivePackReceipt(REAL, TRUST, { id: META.id, size: META.size + 1 }), 'size-mismatch');
  rejects(() => verifyDrivePackReceipt(REAL, pinned(), { id: META.id, size: META.size }), 'unknown-key');
  const t = structuredClone(REAL); t.receipt.receipt.acceptedAt += 1;
  rejects(() => verifyDrivePackReceipt(t, TRUST, { id: META.id, size: META.size }), 'bad-signature');
  const s = structuredClone(REAL); s.receipt.sig.sig = (s.receipt.sig.sig[0] === 'A' ? 'B' : 'A') + s.receipt.sig.sig.slice(1);
  rejects(() => verifyDrivePackReceipt(s, TRUST, { id: META.id, size: META.size }), 'bad-signature');
  rejects(() => verifyDrivePackReceipt({ sha256: META.id, bytes: META.size }, TRUST, { id: META.id, size: META.size }), 'missing');
});

test('key lifetime, and what a Drive pack receipt must and must not claim', () => {
  verifyDrivePackReceipt(signed(), pinned(), { id, size });
  rejects(() => verifyDrivePackReceipt(signed(), pinned({ keyEpoch: 2 }), { id, size }), 'key-epoch-mismatch');
  rejects(() => verifyDrivePackReceipt(signed(), pinned({ notBefore: 1001 }), { id, size }), 'accepted-before-key-valid');
  rejects(() => verifyDrivePackReceipt(signed(), pinned({ notAfter: 1000 }), { id, size }), 'accepted-after-key-expired');
  rejects(() => verifyDrivePackReceipt(signed(), pinned({ revokedAt: 1000 }), { id, size }), 'key-revoked');
  verifyDrivePackReceipt(signed(), pinned({ revokedAt: 1001 }), { id, size });
  rejects(() => verifyDrivePackReceipt(signed(), pinned({ publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: b64url(ed25519.getPublicKey(ed25519.utils.randomPrivateKey())) } }), { id, size }), 'pinned-key-does-not-match-key-id');
  rejects(() => verifyDrivePackReceipt(signed({ kind: 1 }), pinned(), { id, size }), 'kind-mismatch');
  rejects(() => verifyDrivePackReceipt(signed({ requestId: '0x' + 'cd'.repeat(32) }), pinned(), { id, size }), 'requestId-mismatch');
  rejects(() => verifyDrivePackReceipt(signed({ requester: '0x' + '01'.repeat(32) }), pinned(), { id, size }), 'requester-mismatch');
  rejects(() => verifyDrivePackReceipt(signed({ state: 10 }), pinned(), { id, size }), 'gateway-claims-policy-satisfied');
  rejects(() => verifyDrivePackReceipt(signed({ storeClass: 9 }), pinned(), { id, size }), 'unknown-store-class');
  const extra = signed(); extra.receipt.receipt.extra = 1;
  rejects(() => verifyDrivePackReceipt(extra, pinned(), { id, size }), 'fields-do-not-match');
  const otherKey = signed(); otherKey.receipt.sig.key = '0x' + '00'.repeat(32);
  rejects(() => verifyDrivePackReceipt(otherKey, pinned(), { id, size }), 'signature-key-is-not-receipt-key');
});

test('the pinned yataverse.com key set is the one the service publishes in its source', () => {
  // Same values as app-itonami-yataverse worker/wrangler.jsonc RECEIPT_PUBLIC_KEYS (epoch 1).
  assert.equal(TRUST.signer, 'did:web:yataverse.com');
  assert.deepEqual(TRUST.keys.map((k) => [k.keyId, k.keyEpoch]), [['0xad062e68a246d01a369edc6d3713cbbc737b8469208796e52b8c6e943e92eafc', 1]]);
  assert.equal(hex(keyIdFor(Buffer.from(TRUST.keys[0].publicKeyJwk.x, 'base64url'))), TRUST.keys[0].keyId);
});
