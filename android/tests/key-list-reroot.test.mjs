// The published key list after the sequence-2 re-root (AWAI-3775). The old root private key was never
// found, so the list was re-signed under a new development root: the list must verify under the new root
// and be refused under the retired root, and one key may appear in only one role at 3072 bits.
// The retired root is pinned here as base64 of its SubjectPublicKeyInfo (a public key, already published
// as store/keys/store-root.der before the re-root, sha256 c3ad794d…).
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyKeyList, SCHEMA} from '../client/key-list.js';

const OLD_ROOT_B64 = 'MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAxWLf1AWjFxP0YbG/hINoCXouS0HeuohvOQB/rO3iNkpLwdhvvlRo8LhvJQsjfv4xOx1LcUe4OjsEcq+byevAaEsQeRK5+zl+rzi5i0PwprmvoPr5jNh7Wh+4ew3BVm2F2lKebakiiq5U1y3uowlOku6/XTVWQh+I9OWiEUPf7Okt5CzuZyr/3vQd99H2wwu2qqqmugiY2BsRLIW1Yi9GBfdov9mUjXNKdLYvCupjSxWCFLtPXXjiOqpdKGsNdEcO2rzkB5uJoCcGJobPoRxOAXpHwfTHw4gfD9kM3g/ei63WljxKHMAM3ITC63uca3WRrPr+Dx/2chKLxF63QHbBGbF4KUUtDNBv4pOS3E/SyJyS+mkSmkthBWM/xBELkudZi4ntVms3lVv+SR1i/7n5Am+fyavk2HfjVw5nHfUQkhUIhG9LRXjfu4Ei+ljcCQGojN3xRZQRqqHoLI+FPNVrvhu+060UV7UdbiyvLHHi2OyfdQs3T9omL51NVR7qKoAxAgMBAAE=';

const readBytes = u => new Uint8Array(readFileSync(u));
const env = JSON.parse(readFileSync(new URL('../../store/latest/keys-envelope.json', import.meta.url), 'utf8'));
const raw = new TextEncoder().encode(env.raw);
const sig = new Uint8Array(Buffer.from(env.signature, 'base64'));
const newRoot = readBytes(new URL('../../store/keys/store-root.der', import.meta.url));
const oldRoot = new Uint8Array(Buffer.from(OLD_ROOT_B64, 'base64'));
const now = Math.floor(Date.now() / 1000);

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Buffer.from(digest).toString('hex');
}

function roleEntries() {
  const lines = new TextDecoder('ascii').decode(raw).trimEnd().split('\n');
  assert.equal(lines[0], SCHEMA);
  assert.equal(lines[1], 'sequence 2');
  return lines.slice(4).map(line => {
    const [kind, role, b64] = line.split(' ');
    assert.equal(kind, 'key');
    return {role, spki: new Uint8Array(Buffer.from(b64, 'base64'))};
  });
}

test('the published list verifies under the new root at sequence 2', async () => {
  assert.equal(await sha256Hex(newRoot), '8707b4bbca6d14338f6ef29e816a2141594b7f9a9e70f338258b00682bec0e5b');
  const list = await verifyKeyList(raw, sig, newRoot, now, 2);
  assert.equal(list.sequence, 2);
  assert.equal(list.keys.catalog.length, 1);
  assert.equal(list.keys.pointer.length, 1);
});

test('the sequence-2 list is refused under the retired root', async () => {
  assert.equal(await sha256Hex(oldRoot), 'c3ad794d52bdc3f79693a70b6b6b2a68ae2430f068b14c52851a6431b684c436');
  await assert.rejects(() => verifyKeyList(raw, sig, oldRoot, now, 2), /keys-signature/);
});

test('the published list orders catalog before pointer with unique 3072-bit keys', async () => {
  const entries = roleEntries();
  assert.deepEqual(entries.map(e => e.role), ['catalog', 'pointer']);
  const ids = entries.map(e => sha256Hex(e.spki));
  assert.deepEqual(await Promise.all(ids), [
    '73e8cf0d0ac997713adc296a25a96ce49755768a6327ded41e45621e2e0f5189',
    'c158736823262a44c3832bafcb8da394a2f2eb24bd510aa44b8328dc3ca80e5d']);
  assert.equal(new Set(entries.map(e => Buffer.from(e.spki).toString('base64'))).size, entries.length);
  for (const {spki} of entries) {
    const key = await globalThis.crypto.subtle.importKey('spki', spki, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
    assert.equal(key.algorithm?.modulusLength, 3072);
  }
});
