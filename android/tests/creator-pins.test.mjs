import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const SIGNER = 'a90ff0c5b71570eb239356bc8bf2d97005f63c6b92924e001e065b5063a2f049';
const SUPERSEDED_DOUGAKA_SHA = '88c1673360208bec2ce9295ebc641af8c0b8eb19c24338829c7df05b06827479';

// Creator-dapp pins (AWAI-3115, Store item 134): [id, file suffix, rev dir].
// Six apps live in r112; the rebuilt dougaka (consent fix ca99706cc2) lives in r113.
// The file is <suffix>.apk in its rev directory; the catalog asset is packages/<suffix>.apk.
const CREATOR = [
  ['network.itonami.animeka', 'animeka', 'dev-20261123-r112'],
  ['network.itonami.dougaka', 'dougaka', 'dev-20261123-r113'],
  ['network.awai.gaka', 'gaka', 'dev-20261123-r112'],
  ['network.itonami.gameka', 'gameka', 'dev-20261123-r112'],
  ['network.itonami.isco2641', 'isco2641', 'dev-20261123-r112'],
  ['network.itonami.mangaka', 'mangaka', 'dev-20261123-r112'],
  ['network.itonami.ongakuka', 'ongakuka', 'dev-20261123-r112'],
];

const pins = JSON.parse(readFileSync(path.join(root, 'android/online-pins.dev.json'), 'utf8'));
const catalog113 = JSON.parse(readFileSync(path.join(root, 'store/distribution/dev-20261123-r113/catalog-rev113-raw.json'), 'utf8'));
const catalog112 = JSON.parse(readFileSync(path.join(root, 'store/distribution/dev-20261123-r112/catalog-rev112-raw.json'), 'utf8'));

const hashCache = new Map();
function fileInfo(rev, suffix) {
  const key = `${rev}/${suffix}`;
  if (!hashCache.has(key)) {
    const buf = readFileSync(path.join(root, `store/distribution/${rev}/${suffix}.apk`));
    hashCache.set(key, {bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex')});
  }
  return hashCache.get(key);
}

// Fails closed on any drift: missing pin/file, bytes/sha mismatch against both the
// pin and the catalog, catalog signer mismatch, or two entries sharing one file.
function checkCreator(pinsDoc, catalogDoc) {
  assert.equal(catalogDoc.schema, 'itonami.store.bundled.v1');
  assert.equal(catalogDoc.revision, 113);
  const byId = new Map(catalogDoc.apps.map(a => [a.id, a]));
  const files = new Set();
  for (const [id, suffix, rev] of CREATOR) {
    const pin = pinsDoc.apks[id];
    assert(pin, `missing pin for ${id}`);
    assert.equal(new URL(pin.url).pathname, `/network-awai/awai-os/${pinsDoc.revision}/store/distribution/${rev}/${suffix}.apk`);
    const info = fileInfo(rev, suffix);
    assert.equal(pin.maxBytes, info.bytes, `${id} pin bytes drift`);
    assert.equal(pin.sha256, info.sha256, `${id} pin sha256 drift`);
    const app = byId.get(id);
    assert(app, `missing catalog entry for ${id}`);
    assert.equal(app.versionCode, 1000, `${id} versionCode`);
    assert.equal(app.versionName, '0.1.0', `${id} versionName`);
    const arts = app.artifacts.filter(a => a.platform === 'android' && a.runtime === 'android' && a.kind === 'apk');
    assert.equal(arts.length, 1, `${id} android artifact count`);
    const art = arts[0];
    assert.equal(art.asset, `packages/${suffix}.apk`, `${id} catalog asset`);
    assert.equal(art.bytes, info.bytes, `${id} catalog bytes drift`);
    assert.equal(art.sha256, info.sha256, `${id} catalog sha256 drift`);
    assert.equal(art.signerSha256, SIGNER, `${id} catalog signer`);
    const fileKey = `${rev}/${suffix}.apk`;
    assert(!files.has(fileKey), `two entries share ${fileKey}`);
    files.add(fileKey);
  }
  return true;
}

test('creator pins: files exist in their revs and match pin and catalog (bytes, sha256, signer)', () => {
  assert.equal(checkCreator(pins, catalog113), true);
});

test('creator pins: no two entries share a file and the dev pins validate', async () => {
  const runtime = new URL('../../otehon/shell/vendor/kotoba-client-runtime.js', import.meta.url);
  const text = readFileSync(new URL('../client/online.js', import.meta.url), 'utf8')
    .replace("'./runtime.js'", JSON.stringify(runtime.href))
    .replace("'./key-list.js'", JSON.stringify(new URL('../client/key-list.js', import.meta.url).href));
  const {validatePins} = await import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'));
  assert.equal(validatePins(pins), pins);
  assert.equal(Object.keys(pins.apks).length, 17);
  const names = CREATOR.map(([, suffix, rev]) => `${rev}/${suffix}.apk`);
  assert.equal(new Set(names).size, CREATOR.length);
});

test('catalog r113 is identical to r112 except revision and dougaka digest', () => {
  assert.equal(catalog112.revision, 112);
  assert.equal(catalog113.revision, 113);
  assert.equal(catalog113.expiresAt, catalog112.expiresAt);
  assert.deepEqual(catalog113.apps.map(a => a.id), catalog112.apps.map(a => a.id));
  const a112 = new Map(catalog112.apps.map(a => [a.id, JSON.stringify(a)]));
  const a113 = new Map(catalog113.apps.map(a => [a.id, JSON.stringify(a)]));
  for (const [id, v112] of a112) {
    if (id === 'network.itonami.dougaka') continue;
    assert.equal(a113.get(id), v112, `${id} changed between r112 and r113`);
  }
  const d112 = JSON.parse(a112.get('network.itonami.dougaka'));
  const d113 = JSON.parse(a113.get('network.itonami.dougaka'));
  const art112 = d112.artifacts.find(a => a.asset === 'packages/dougaka.apk');
  const art113 = d113.artifacts.find(a => a.asset === 'packages/dougaka.apk');
  assert.equal(art112.sha256, SUPERSEDED_DOUGAKA_SHA);
  assert.notEqual(art113.sha256, SUPERSEDED_DOUGAKA_SHA);
  assert.equal(art113.bytes, art112.bytes);
  assert.equal(art113.signerSha256, SIGNER);
});

test('superseded r112 dougaka digest is no longer pinned; the r112 file itself is untouched', () => {
  assert.notEqual(pins.apks['network.itonami.dougaka'].sha256, SUPERSEDED_DOUGAKA_SHA);
  const old = fileInfo('dev-20261123-r112', 'dougaka');
  assert.equal(old.sha256, SUPERSEDED_DOUGAKA_SHA);
  assert.equal(old.bytes, 12802310);
});

test('creator pins: drift fails closed (sha, bytes, signer, shared file)', () => {
  const clone = () => JSON.parse(JSON.stringify({pins, catalog: catalog113}));
  let d = clone();
  d.pins.apks['network.awai.gaka'].sha256 = '0'.repeat(64);
  assert.throws(() => checkCreator(d.pins, d.catalog));
  d = clone();
  d.pins.apks['network.awai.gaka'].maxBytes += 1;
  assert.throws(() => checkCreator(d.pins, d.catalog));
  d = clone();
  d.catalog.apps.find(a => a.id === 'network.awai.gaka').artifacts[0].signerSha256 = '0'.repeat(64);
  assert.throws(() => checkCreator(d.pins, d.catalog));
  d = clone();
  d.catalog.apps.find(a => a.id === 'network.awai.gaka').artifacts[0].asset = 'packages/mangaka.apk';
  assert.throws(() => checkCreator(d.pins, d.catalog));
});
