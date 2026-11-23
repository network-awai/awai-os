import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const REV = 'dev-20261123-r112';
const SIGNER = 'a90ff0c5b71570eb239356bc8bf2d97005f63c6b92924e001e065b5063a2f049';

// Creator-dapp pins (AWAI-3115, Store item 134): [id, file suffix]. The file is
// <suffix>.apk in the rev directory; the catalog asset is packages/<suffix>.apk.
const CREATOR = [
  ['network.itonami.animeka', 'animeka'],
  ['network.itonami.dougaka', 'dougaka'],
  ['network.awai.gaka', 'gaka'],
  ['network.itonami.gameka', 'gameka'],
  ['network.itonami.isco2641', 'isco2641'],
  ['network.itonami.mangaka', 'mangaka'],
  ['network.itonami.ongakuka', 'ongakuka'],
];

const pins = JSON.parse(readFileSync(path.join(root, 'android/online-pins.dev.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(path.join(root, `store/distribution/${REV}/catalog-rev112-raw.json`), 'utf8'));

const hashCache = new Map();
function fileInfo(suffix) {
  if (!hashCache.has(suffix)) {
    const buf = readFileSync(path.join(root, `store/distribution/${REV}/${suffix}.apk`));
    hashCache.set(suffix, {bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex')});
  }
  return hashCache.get(suffix);
}

// Fails closed on any drift: missing pin/file, bytes/sha mismatch against both the
// pin and the catalog, catalog signer mismatch, or two entries sharing one file.
function checkCreator(pinsDoc, catalogDoc) {
  assert.equal(catalogDoc.schema, 'itonami.store.bundled.v1');
  assert.equal(catalogDoc.revision, 112);
  const byId = new Map(catalogDoc.apps.map(a => [a.id, a]));
  const files = new Set();
  for (const [id, suffix] of CREATOR) {
    const pin = pinsDoc.apks[id];
    assert(pin, `missing pin for ${id}`);
    assert.equal(new URL(pin.url).pathname, `/network-awai/awai-os/${pinsDoc.revision}/store/distribution/${REV}/${suffix}.apk`);
    const info = fileInfo(suffix);
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
    assert(!files.has(suffix), `two entries share ${suffix}.apk`);
    files.add(suffix);
  }
  return true;
}

test('creator pins: files exist in r112 and match pin and catalog (bytes, sha256, signer)', () => {
  assert.equal(checkCreator(pins, catalog), true);
});

test('creator pins: no two entries share a file and the dev pins validate', async () => {
  const runtime = new URL('../../otehon/shell/vendor/kotoba-client-runtime.js', import.meta.url);
  const text = readFileSync(new URL('../client/online.js', import.meta.url), 'utf8')
    .replace("'./runtime.js'", JSON.stringify(runtime.href))
    .replace("'./key-list.js'", JSON.stringify(new URL('../client/key-list.js', import.meta.url).href));
  const {validatePins} = await import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'));
  assert.equal(validatePins(pins), pins);
  assert.equal(Object.keys(pins.apks).length, 17);
  const names = CREATOR.map(([, suffix]) => `${suffix}.apk`);
  assert.equal(new Set(names).size, CREATOR.length);
});

test('creator pins: drift fails closed (sha, bytes, signer, shared file)', () => {
  const clone = () => JSON.parse(JSON.stringify({pins, catalog}));
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
