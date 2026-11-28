// AWAI-3730: the static Store entry page lists only what the signed pointer, the signed
// catalog, the pins and the local bytes agree on.
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
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

test('the published pointer and catalog build a page that matches the catalog', async () => {
  const input = published();
  const {store, files} = await buildSite(input);
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
  assert.equal(manifest.files['logo.png'], sha256(files['logo.png']));
});

test('the page is a document: no script, one same-origin image, strict CSP', async () => {
  const {files} = (await buildSite(published()));
  const html = files['index.html'].toString('utf8');
  assert(!/<script|<iframe|<form|<object|<embed|\son[a-z]+=|\sstyle=|javascript:/i.test(html));
  assert(html.includes(`content="default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'"`));
  assert.deepEqual([...html.matchAll(/<link[^>]*href="([^"]+)"/g)].map(m => m[1]), ['style.css']);
  assert.deepEqual([...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map(m => m[1]), ['logo.png']);
  assert(files['logo.png'].subarray(1, 4).toString('latin1') === 'PNG');
  assert(!/url\(|@import|@font-face/i.test(files['style.css'].toString('utf8')));
  assert(html.includes('開発版です'));
  for (const [, href] of html.matchAll(/<a[^>]*href="([^"]+)"/g))
    assert(href === 'site-manifest.json'
      || /^#/.test(href)
      || /^https:\/\/raw\.githubusercontent\.com\/network-awai\/awai-os\/[0-9a-f]{40}\/store\/distribution\//.test(href), href);
});

test('the build is deterministic', async () => {
  const a = (await buildSite(published())).files, b = (await buildSite(published())).files;
  for (const name of Object.keys(a)) assert(a[name].equals(b[name]), name);
});

// AWAI-4070: browse anchors, one quiet featured card, then the plain list.
test('browse is anchored, featured once, quiet footer on the page', async () => {
  const {files} = (await buildSite(published()));
  const html = files['index.html'].toString('utf8');
  const anchors = [...html.matchAll(/<a[^>]*href="([^"]+)"/g)].map(m => m[1]).filter(h => h.startsWith('#'));
  assert.deepEqual(anchors, ['#apps', '#how', '#verify', '#record']);
  for (const id of ['apps', 'how', 'verify', 'record']) assert(html.includes(`id="${id}"`), id);
  assert.equal((html.match(/class="card app featured"/g) || []).length, 1);
  assert(html.includes('おすすめ') && html.includes('すべてのアプリ'));
  assert(html.includes('広告や追跡はなく'));
  // featured app appears exactly once in the whole page (featured + list split)
  const store = (await buildSite(published())).store;
  for (const app of store.apps) {
    const count = html.split(`id="${app.id}"`).length - 1;
    assert.equal(count, 1, `${app.id} appears ${count} times`);
  }
});

test('catalog text is escaped', async () => {
  const store = (await buildSite(published())).store;
  store.apps[0] = {...store.apps[0], name: '<b>x</b>', description: '"quoted" & <i>tagged</i>'};
  const html = renderHtml(store);
  assert(html.includes('&lt;b&gt;x&lt;/b&gt;') && html.includes('&quot;quoted&quot; &amp; &lt;i&gt;tagged&lt;/i&gt;'));
  assert(!html.includes('<b>') && !html.includes('<i>'));
});

// AWAI-3882: the per-app detail view renders the catalog publisher as 配布元, and the
// manifest carries the same value — a defined-but-not-displayed publisher would be caught here.
test('the detail view renders each app publisher', async () => {
  const input = published();
  const {files} = await buildSite(input);
  const catalog = JSON.parse(JSON.parse(input.read(catalogPath(input)).toString('utf8')).raw);
  const html = files['index.html'].toString('utf8');
  assert(html.includes('配布元'));
  for (const app of catalog.apps) assert(html.includes(app.publisher), `publisher rendered for ${app.id}`);
  const manifest = JSON.parse(files['site-manifest.json'].toString('utf8'));
  assert.deepEqual(manifest.apps.map(a => a.publisher), catalog.apps.map(a => a.publisher));
});

const rejects = (name, change, code) => test(`rejects ${name}`, async () => {
  await assert.rejects(verifyStore(change(published())), code instanceof RegExp ? code : {message: code});
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
rejects('the published pointer checked against another root', input => ({...input,
  rootDer: generateKeyPairSync('rsa', {modulusLength: 2048}).publicKey.export({type: 'spki', format: 'der'})}), 'keys-signature');
rejects('no key list', input => ({...input, keysBytes: null}), 'keys-missing');



// AWAI-3775: the root-signed key list. Synthetic pointer and catalog, read from memory.
// AWAI-3882: publisher defaults to the single-definition value; pass publisher: null to omit it
// (fail-closed test) or any string to use it verbatim.
const keyListInput = ({
  signPointer, signCatalog, signList, listRoot, publisher = 'Awai Network LLC',
  appId = 'network.itonami.yotei', apkBytes = null,
} = {}) => {
  const rsa = () => generateKeyPairSync('rsa', {modulusLength: 2048});
  const root = rsa(), cat = rsa(), ptr = rsa(), other = rsa();
  const k = {root, cat, ptr, other};
  const spki = key => key.publicKey.export({type: 'spki', format: 'der'});
  const now = 1_800_000_000;
  const list = `itonami.store.keys.v1\nsequence 2\nissued ${now - 60}\nexpires ${now + 90 * 86400}\nkey catalog ${spki(cat).toString('base64')}\nkey pointer ${spki(ptr).toString('base64')}\n`;
  const env = (raw, key) => Buffer.from(JSON.stringify({raw, signature: sign('sha256', Buffer.from(raw), key.privateKey).toString('base64')}));
  const rev = 'a'.repeat(40), base = `https://raw.githubusercontent.com/network-awai/awai-os/${rev}/store/distribution/dev-test/`;
  const app = {id: appId, name: 'Fixture app', versionName: '1', versionCode: 1, artifacts: []};
  if (publisher !== null) app.publisher = publisher;
  const apkPath = 'store/distribution/dev-test/fixture.apk';
  const apks = {};
  if (apkBytes) {
    const digest = sha256(apkBytes);
    app.artifacts.push({platform: 'android', kind: 'apk', sha256: digest,
      bytes: apkBytes.length, signerSha256: DEV_SIGNER});
    apks[appId] = {url: base + 'fixture.apk', sha256: digest, maxBytes: apkBytes.length};
  }
  const catalog = env(JSON.stringify({schema: 'itonami.store.bundled.v1', revision: 110, expiresAt: now + 86400,
    apps: [app]}), k[signCatalog ?? 'cat']);
  const pointer = env(JSON.stringify({schema: 'itonami.store.latest.v1', sequence: 4, issuedAt: now - 60, expiresAt: now + 86400,
    pins: {revision: rev, catalog: {url: base + 'catalog-envelope.json', sha256: sha256(catalog), maxBytes: 131072}, apks}}), k[signPointer ?? 'ptr']);
  const published = published0();
  const files = new Map([['store/distribution/dev-test/catalog-envelope.json', catalog], [apkPath, apkBytes]]);
  return {...published, now, pointerBytes: pointer, rootDer: spki(k[listRoot ?? 'root']), keysBytes: env(list, k[signList ?? 'root']),
    read: path => files.get(path) ?? null,
    keys: {cat: spki(cat), root: spki(root)}};
};
const published0 = () => repositoryInput(root, 0);

test('key list: listed pointer and catalog keys build the page', async () => {
  const input = keyListInput();
  const {store, files} = await buildSite(input);
  assert.equal(store.trust.mode, 'key-list');
  assert.equal(store.trust.sequence, 2);
  assert.deepEqual(store.trust.catalogKeys, [sha256(input.keys.cat)]);
  assert.equal(store.trust.rootSha256, sha256(input.keys.root));
  assert.equal(store.revision, 110);
  const html = files['index.html'].toString('utf8');
  assert(html.includes('鍵の一覧') && html.includes('本番の署名鍵はまだありません。'));
  assert.equal(JSON.parse(files['site-manifest.json'].toString('utf8')).trust.mode, 'key-list');
});
for (const [name, change, code] of [
  ['a pointer signed by the catalog key', {signPointer: 'cat'}, 'pointer-signature'],
  ['a pointer signed by the root', {signPointer: 'root'}, 'pointer-signature'],
  ['a catalog signed by the pointer key', {signCatalog: 'ptr'}, 'catalog-signature'],
  ['a catalog signed by the root', {signCatalog: 'root'}, 'catalog-signature'],
  ['a list not signed by the root', {signList: 'other'}, 'keys-signature'],
  ['a list checked against another root', {listRoot: 'other'}, 'keys-signature'],
]) test(`key list: rejects ${name}`, async () => {
  await assert.rejects(verifyStore(keyListInput(change)), {message: code});
});
test('key list: a root without a list is refused', async () => {
  await assert.rejects(verifyStore({...keyListInput(), keysBytes: null}), {message: 'keys-missing'});
});

test('the signed Aozora package is rendered without a download when no APK is pinned', async () => {
  const {store, files} = await buildSite(keyListInput({appId: 'app.aozora'}));
  assert.equal(store.apps[0].id, 'app.aozora');
  assert.equal(store.apps[0].download, null);
  assert.match(files['index.html'].toString('utf8'), /id="app\.aozora"/);
});

test('a pinned Aozora download is rendered only with its signed digest', async () => {
  const apk = Buffer.from('Aozora fixture');
  const input = keyListInput({appId: 'app.aozora', apkBytes: apk});
  const {store, files} = await buildSite(input);
  const {download} = store.apps[0];
  assert.equal(download.sha256, sha256(apk));
  assert.equal(download.bytesChecked, true);
  assert(files['index.html'].toString('utf8').includes(`href="${download.url}"`));
  await assert.rejects(verifyStore(withFile(input, 'store/distribution/dev-test/fixture.apk', Buffer.from('changed'))),
    {message: 'apk-digest'});
});

test('a similarly named package outside the supported namespaces is refused', async () => {
  await assert.rejects(verifyStore(keyListInput({appId: 'app.aozora.awai.preview'})), {message: 'app-id'});
});

// AWAI-3882: fail closed — a catalog entry whose publisher does not resolve (missing or
// blank) aborts the build instead of rendering a blank 配布元.
test('publisher: a catalog entry without a publisher fails closed', async () => {
  await assert.rejects(verifyStore(keyListInput({publisher: null})), {message: 'publisher'});
});
test('publisher: a catalog entry with a blank publisher fails closed', async () => {
  await assert.rejects(verifyStore(keyListInput({publisher: '   '})), {message: 'publisher'});
});
