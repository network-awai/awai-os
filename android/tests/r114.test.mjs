// r114 publication (AWAI-3775 re-root): the first catalog and pointer signed with the new key list
// (sequence 2). Fails closed: the catalog apps are byte-identical to r113 except revision, both
// envelopes authenticate under the new root list and are refused under the retired root, and the
// pointer pins match the envelope file and every pinned APK in the tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const REV = 'dev-20261123-r114';

const OLD_ROOT_B64 = 'MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAxWLf1AWjFxP0YbG/hINoCXouS0HeuohvOQB/rO3iNkpLwdhvvlRo8LhvJQsjfv4xOx1LcUe4OjsEcq+byevAaEsQeRK5+zl+rzi5i0PwprmvoPr5jNh7Wh+4ew3BVm2F2lKebakiiq5U1y3uowlOku6/XTVWQh+I9OWiEUPf7Okt5CzuZyr/3vQd99H2wwu2qqqmugiY2BsRLIW1Yi9GBfdov9mUjXNKdLYvCupjSxWCFLtPXXjiOqpdKGsNdEcO2rzkB5uJoCcGJobPoRxOAXpHwfTHw4gfD9kM3g/ei63WljxKHMAM3ITC63uca3WRrPr+Dx/2chKLxF63QHbBGbF4KUUtDNBv4pOS3E/SyJyS+mkSmkthBWM/xBELkudZi4ntVms3lVv+SR1i/7n5Am+fyavk2HfjVw5nHfUQkhUIhG9LRXjfu4Ei+ljcCQGojN3xRZQRqqHoLI+FPNVrvhu+060UV7UdbiyvLHHi2OyfdQs3T9omL51NVR7qKoAxAgMBAAE=';

function sha256Hex(buf) { return createHash('sha256').update(buf).digest('hex'); }

async function list() {
  const {verifyKeyList} = await import('../client/key-list.js');
  const env = JSON.parse(readFileSync(path.join(root, 'store/latest/keys-envelope.json'), 'utf8'));
  const rootSpki = new Uint8Array(readFileSync(path.join(root, 'store/keys/store-root.der')));
  return verifyKeyList(new TextEncoder().encode(env.raw), new Uint8Array(Buffer.from(env.signature, 'base64')),
    rootSpki, Math.floor(Date.now() / 1000), 2);
}

test('r114 catalog is identical to r113 except revision 114', () => {
  const r113 = JSON.parse(readFileSync(path.join(root, 'store/distribution/dev-20261123-r113/catalog-rev113-raw.json'), 'utf8'));
  const r114 = JSON.parse(readFileSync(path.join(root, `store/distribution/${REV}/catalog-rev114-raw.json`), 'utf8'));
  assert.equal(r113.revision, 113);
  assert.equal(r114.revision, 114);
  assert.equal(r114.expiresAt, r113.expiresAt);
  assert.equal(r114.apps.length, 17);
  assert.deepEqual(r114.apps, r113.apps);
});

test('r114 catalog envelope and pointer authenticate under the new root list', async () => {
  const {authentic} = await import('../client/key-list.js');
  const l = await list();
  assert.equal(l.sequence, 2);
  const cat = JSON.parse(readFileSync(path.join(root, `store/distribution/${REV}/catalog-envelope.json`), 'utf8'));
  assert.equal(cat.raw, readFileSync(path.join(root, `store/distribution/${REV}/catalog-rev114-raw.json`), 'utf8'));
  assert.equal(await authentic(l, 'catalog', new TextEncoder().encode(cat.raw), new Uint8Array(Buffer.from(cat.signature, 'base64'))), true);
  const ptr = JSON.parse(readFileSync(path.join(root, 'store/latest/pointer-envelope.json'), 'utf8'));
  assert.equal(await authentic(l, 'pointer', new TextEncoder().encode(ptr.raw), new Uint8Array(Buffer.from(ptr.signature, 'base64'))), true);
});

test('the new envelopes are refused under the retired sequence-1 root', async () => {
  const {verifyKeyList} = await import('../client/key-list.js');
  const env = JSON.parse(readFileSync(path.join(root, 'store/latest/keys-envelope.json'), 'utf8'));
  const old = new Uint8Array(Buffer.from(OLD_ROOT_B64, 'base64'));
  await assert.rejects(
    () => verifyKeyList(new TextEncoder().encode(env.raw), new Uint8Array(Buffer.from(env.signature, 'base64')),
      old, Math.floor(Date.now() / 1000), 2),
    /keys-signature/);
});

test('pointer pins (sequence 5) match the catalog envelope and every pinned APK', () => {
  const ptr = JSON.parse(readFileSync(path.join(root, 'store/latest/pointer-envelope.json'), 'utf8'));
  const v = JSON.parse(ptr.raw);
  assert.equal(v.sequence, 5);
  const pins = JSON.parse(readFileSync(path.join(root, 'android/online-pins.dev.json'), 'utf8'));
  assert.deepEqual(v.pins, pins);
  assert.equal(Object.keys(pins.apks).length, 17);
  const envBytes = readFileSync(path.join(root, `store/distribution/${REV}/catalog-envelope.json`));
  assert.equal(pins.catalog.sha256, sha256Hex(envBytes));
  assert.equal(pins.catalog.maxBytes, envBytes.length);
  const catalogAtRevision = `/store/distribution/${REV}/catalog-envelope.json`;
  assert(new URL(pins.catalog.url).pathname.endsWith(catalogAtRevision));
  for (const [id, pin] of Object.entries(pins.apks)) {
    const url = new URL(pin.url);
    assert.equal(url.hostname, 'raw.githubusercontent.com');
    const m = url.pathname.match(/^\/network-awai\/awai-os\/([0-9a-f]{40})\/store\/distribution\/([^/]+)\/([^/]+)$/);
    assert(m, `${id} url shape`);
    assert.equal(m[1], pins.revision);
    const file = path.join(root, 'store/distribution', m[2], m[3]);
    assert(existsSync(file), `${id} file missing: ${m[2]}/${m[3]}`);
    const buf = readFileSync(file);
    assert.equal(buf.length, pin.maxBytes, `${id} bytes drift`);
    assert.equal(sha256Hex(buf), pin.sha256, `${id} sha256 drift`);
  }
});
