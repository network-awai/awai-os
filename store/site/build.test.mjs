// AWAI-3730: the static Store entry page lists only what the signed pointer, the signed
// catalog, the pins and the local bytes agree on.
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {buildSite, DEV_SIGNER, renderHtml, repositoryInput, verifyStore} from './build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const published = () => {
  const input = repositoryInput(root, 0);
  const pointer = JSON.parse(JSON.parse(input.pointerBytes.toString('utf8')).raw);
  return {...input, now: pointer.issuedAt + 60, pointer};
};
const catalogPath = input => /store\/distribution\/.+$/.exec(input.pointer.pins.catalog.url)[0];
const withFile = (input, path, bytes) => ({...input, read: p => p === path ? bytes : input.read(p)});

test('the published pointer and catalog build a page that matches the catalog', () => {
  const input = published();
  const {store, files} = buildSite(input);
  const catalog = JSON.parse(JSON.parse(input.read(catalogPath(input)).toString('utf8')).raw);
  assert.equal(store.signer, DEV_SIGNER);
  assert.equal(store.sequence, input.pointer.sequence);
  assert.equal(store.revision, catalog.revision);
  assert.deepEqual(store.apps.map(a => a.id), catalog.apps.map(a => a.id));
  const html = files['index.html'].toString('utf8');
  for (const app of catalog.apps) {
    const apk = app.artifacts.find(a => a.platform === 'android' && a.kind === 'apk');
    const pin = input.pointer.pins.apks[app.id];
    assert(html.includes(`id="${app.id}"`));
    if (!pin) continue;
    assert(html.includes(apk.sha256), app.id);
    assert(html.includes(`href="${pin.url}"`), app.id);
    assert(input.read(/store\/distribution\/.+$/.exec(pin.url)[0]), `${app.id} bytes are in the repository`);
  }
  assert(store.apps.filter(a => a.download).every(a => a.download.bytesChecked));
  const manifest = JSON.parse(files['site-manifest.json'].toString('utf8'));
  assert.equal(manifest.schema, 'awai.store-site.v1');
  assert.equal(manifest.development, true);
  assert.equal(manifest.files['index.html'], sha256(files['index.html']));
  assert.equal(manifest.files['style.css'], sha256(files['style.css']));
});

test('the page is a document: no script, no remote subresource, strict CSP', () => {
  const html = buildSite(published()).files['index.html'].toString('utf8');
  assert(!/<script|<iframe|<img|<form|\son[a-z]+=|javascript:/i.test(html));
  assert(html.includes(`content="default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'"`));
  assert.deepEqual([...html.matchAll(/<link[^>]*href="([^"]+)"/g)].map(m => m[1]), ['style.css']);
  assert(html.includes('開発版です'));
  for (const [, href] of html.matchAll(/<a[^>]*href="([^"]+)"/g))
    assert(href === 'site-manifest.json' || href === 'https://github.com/network-awai/awai-os/tree/main/store'
      || /^https:\/\/raw\.githubusercontent\.com\/network-awai\/awai-os\/[0-9a-f]{40}\/store\/distribution\//.test(href), href);
});

test('the build is deterministic', () => {
  const a = buildSite(published()).files, b = buildSite(published()).files;
  for (const name of Object.keys(a)) assert(a[name].equals(b[name]), name);
});

test('catalog text is escaped', () => {
  const store = buildSite(published()).store;
  store.apps[0] = {...store.apps[0], name: '<b>x</b>', description: '"quoted" & <i>tagged</i>'};
  const html = renderHtml(store);
  assert(html.includes('&lt;b&gt;x&lt;/b&gt;') && html.includes('&quot;quoted&quot; &amp; &lt;i&gt;tagged&lt;/i&gt;'));
  assert(!html.includes('<b>') && !html.includes('<i>'));
});

const rejects = (name, change, code) => test(`rejects ${name}`, () => {
  assert.throws(() => verifyStore(change(published())), {message: code});
});

rejects('a pointer whose content was changed after signing', input => {
  const envelope = JSON.parse(input.pointerBytes.toString('utf8'));
  envelope.raw = envelope.raw.replace(`"sequence":${input.pointer.sequence}`, `"sequence":${input.pointer.sequence + 1}`);
  return {...input, pointerBytes: Buffer.from(JSON.stringify(envelope))};
}, 'pointer-signature');

rejects('a catalog whose content was changed after signing', input => {
  // The digest pin catches changed bytes first.
  const path = catalogPath(input);
  const envelope = JSON.parse(input.read(path).toString('utf8'));
  envelope.raw = envelope.raw.replace('Yotei', 'Yotel');
  return withFile(input, path, Buffer.from(JSON.stringify(envelope)));
}, 'catalog-digest');

rejects('a missing catalog', input => withFile(input, catalogPath(input), null), 'catalog-missing');

rejects('an APK whose bytes differ from the catalog', input => {
  const [id] = Object.keys(input.pointer.pins.apks).slice(-1);
  const path = /store\/distribution\/.+$/.exec(input.pointer.pins.apks[id].url)[0];
  const bytes = Buffer.from(input.read(path));
  bytes[bytes.length - 1] ^= 1;
  return withFile(input, path, bytes);
}, 'apk-digest');

rejects('an expired pointer', input => ({...input, now: input.pointer.expiresAt}), 'pointer-expired');

rejects('a certificate that is not the pinned signer', input => ({...input, signer: 'f'.repeat(64)}), 'signer-fingerprint');

rejects('a bare public key in place of the pinned certificate', input => {
  const {publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
  return {...input, signerPem: publicKey.export({type: 'spki', format: 'pem'})};
}, /./);
