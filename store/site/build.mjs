#!/usr/bin/env node
// Build the static Itonami Store entry page (AWAI-3730) from the signed latest pointer.
//
// The page is a document: HTML, CSS and one logo image, no script, no request-time handler. Every listed
// download is a commit-pinned URL with its SHA-256, taken from the signed pointer and catalog.
// Nothing is listed unless the pointer signature, the catalog signature, the pins and the
// local bytes all agree. Development signer only: there is no production key yet.
//
// Trust (AWAI-3775): the root public key (store/keys/store-root.der) and the root-signed key list
// (store/latest/keys-envelope.json). The pointer must be signed by a listed pointer key and the catalog by a
// listed catalog key, with the same rules as the Store (android/client/key-list.js, KeyList.java).
//
//   node store/site/build.mjs --out <new dir> [--now <epoch seconds>]
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyKeyList, authentic, CATALOG, POINTER} from '../../android/client/key-list.js';

export const DEV_SIGNER = '2507930b6c21b3c1cd0655527227dba75772096eff85e887bfcce2fb25b49b29';
const PIN_URL = /^https:\/\/raw\.githubusercontent\.com\/network-awai\/awai-os\/([0-9a-f]{40})\/(store\/distribution\/[A-Za-z0-9._\/-]+)$/;
const MAX_LIFETIME = 31 * 24 * 60 * 60;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
const esc = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

function envelopeOf(bytes, code) {
  const envelope = JSON.parse(bytes.toString('utf8'));
  if (Object.keys(envelope).sort().join() !== 'raw,signature') fail(code + '-shape');
  if (typeof envelope.raw !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(envelope.signature)) fail(code + '-shape');
  return envelope;
}

// Who may sign the catalog and the pointer: the key list under the root.
async function trustOf({rootDer, keysBytes, now}) {
  {
    if (!rootDer || !keysBytes) fail('keys-missing');
    const envelope = envelopeOf(keysBytes, 'keys');
    const raw = Buffer.from(envelope.raw, 'utf8');
    let list;
    try { list = await verifyKeyList(new Uint8Array(raw), new Uint8Array(Buffer.from(envelope.signature, 'base64')), new Uint8Array(rootDer), now, 0); }
    catch (e) { fail(e.message); }
    const fingerprints = role => envelope.raw.split('\n').filter(l => l.startsWith(`key ${role} `))
      .map(l => sha256(Buffer.from(l.split(' ')[2], 'base64')));
    return {mode: 'key-list', sequence: list.sequence, expiresAt: list.expiresAt, rootSha256: sha256(rootDer),
      catalogKeys: fingerprints(CATALOG), pointerKeys: fingerprints(POINTER),
      signed: (role, data, sig) => authentic(list, role, new Uint8Array(data), new Uint8Array(sig))};
  }
}

async function openEnvelope(bytes, trust, role, code) {
  const envelope = envelopeOf(bytes, code);
  if (!await trust.signed(role, Buffer.from(envelope.raw, 'utf8'), Buffer.from(envelope.signature, 'base64'))) fail(code + '-signature');
  return JSON.parse(envelope.raw);
}

function pinPath(pin, code) {
  const m = typeof pin?.url === 'string' && PIN_URL.exec(pin.url);
  if (!m || m[2].includes('..') || !/^[0-9a-f]{64}$/.test(pin.sha256) || !Number.isSafeInteger(pin.maxBytes) || pin.maxBytes < 1) fail(code);
  return m[2];
}

function size(bytes) {
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

function date(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

// Verify everything and return the facts the page shows. `read(path)` returns the bytes of a
// repository path, or null when the file is not present locally.
// `signer` is the development APK signer; it only labels APKs, it does not sign the catalog or the pointer.
export async function verifyStore({pointerBytes, rootDer, keysBytes, read, now, signer = DEV_SIGNER}) {
  const trust = await trustOf({rootDer, keysBytes, now});
  const pointer = await openEnvelope(pointerBytes, trust, POINTER, 'pointer');
  if (pointer.schema !== 'itonami.store.latest.v1') fail('pointer-schema');
  if (!Number.isSafeInteger(pointer.sequence) || pointer.sequence < 1) fail('pointer-sequence');
  if (!Number.isSafeInteger(pointer.issuedAt) || !Number.isSafeInteger(pointer.expiresAt)) fail('pointer-time');
  if (pointer.expiresAt <= pointer.issuedAt || pointer.expiresAt - pointer.issuedAt > MAX_LIFETIME) fail('pointer-time');
  if (now >= pointer.expiresAt) fail('pointer-expired');
  const pins = pointer.pins;
  if (!pins || !/^[0-9a-f]{40}$/.test(pins.revision) || !pins.apks || typeof pins.apks !== 'object') fail('pins-shape');

  const catalogBytes = read(pinPath(pins.catalog, 'catalog-pin'));
  if (!catalogBytes) fail('catalog-missing');
  if (catalogBytes.length > pins.catalog.maxBytes || sha256(catalogBytes) !== pins.catalog.sha256) fail('catalog-digest');
  const catalog = await openEnvelope(catalogBytes, trust, CATALOG, 'catalog');
  if (catalog.schema !== 'itonami.store.bundled.v1') fail('catalog-schema');
  if (!Number.isSafeInteger(catalog.revision) || !Array.isArray(catalog.apps)) fail('catalog-shape');
  if (!Number.isSafeInteger(catalog.expiresAt) || now >= catalog.expiresAt) fail('catalog-expired');

  const listed = new Set();
  const apps = catalog.apps.map(app => {
    const knownPackage = app.id === 'app.aozora' || /^network\.(itonami|awai)\.[a-z0-9.]+$/.test(app.id);
    if (!knownPackage || listed.has(app.id)) fail('app-id');
    listed.add(app.id);
    // AWAI-3882: fail closed — every catalog entry must resolve a publisher. A blank or
    // missing publisher aborts the build instead of rendering a blank 配布元.
    if (typeof app.publisher !== 'string' || !app.publisher.trim()) fail('publisher');
    const apk = (app.artifacts || []).find(a => a.platform === 'android' && a.kind === 'apk');
    const pin = pins.apks[app.id];
    let download = null;
    if (apk && pin) {
      const path = pinPath(pin, 'apk-pin');
      if (pin.sha256 !== apk.sha256 || apk.bytes > pin.maxBytes || !/^[0-9a-f]{64}$/.test(apk.signerSha256 || '')) fail('apk-pin-mismatch');
      const bytes = read(path);
      if (bytes && (bytes.length !== apk.bytes || sha256(bytes) !== apk.sha256)) fail('apk-digest');
      download = {url: pin.url, sha256: apk.sha256, bytes: apk.bytes, signerSha256: apk.signerSha256,
        developmentSigner: apk.signerSha256 === signer, bytesChecked: Boolean(bytes)};
    } else if (pin) fail('apk-pin-mismatch');
    return {id: app.id, name: String(app.name), description: String(app.description || ''), publisher: app.publisher,
      versionName: String(app.versionName), versionCode: app.versionCode,
      operations: Array.isArray(app.operations) ? app.operations.length : null, download};
  });
  for (const id of Object.keys(pins.apks)) if (!listed.has(id)) fail('apk-pin-unlisted');
  return {sequence: pointer.sequence, pointerExpiresAt: pointer.expiresAt, revision: catalog.revision,
    catalogExpiresAt: catalog.expiresAt, sourceRevision: pins.revision, signer, apps,
    trust: trust.mode === 'key-list' ? {mode: trust.mode, sequence: trust.sequence, expiresAt: trust.expiresAt, rootSha256: trust.rootSha256,
      catalogKeys: trust.catalogKeys, pointerKeys: trust.pointerKeys} : {mode: trust.mode}};
}

function appHtml(app) {
  const d = app.download;
  const operations = app.operations === null ? '記載なし' : app.operations === 0 ? 'なし' : `${app.operations} 件（アプリ内で、通信のたびに確認します）`;
  const rows = [
    ['パッケージ', esc(app.id)],
    ['配布元', esc(app.publisher)],
    ['版', `${esc(app.versionName)}（versionCode ${esc(app.versionCode)}）`],
  ];
  if (d) rows.push(['大きさ', esc(size(d.bytes))]);
  rows.push(['外部との通信', operations]);
  if (d) rows.push(['SHA-256', esc(d.sha256)],
    ['署名者', `${esc(d.signerSha256)}${d.developmentSigner ? '（開発用の鍵）' : '（リリース用の鍵）'}`]);
  const action = d
    ? `<div class="action"><a class="button primary" href="${esc(d.url)}" rel="noreferrer" download>APK を取得</a>
<p class="caption">リンク先: raw.githubusercontent.com（commit を固定した変わらないファイル）</p></div>`
    : '<p class="caption">Android 向けの APK は公開していません。</p>';
  return `<article class="card app" id="${esc(app.id)}">
<h3>${esc(app.name)}</h3>
<p>${esc(app.description)}</p>
<dl class="facts">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
${action}
</article>`;
}

function featuredHtml(app) {
  return appHtml(app).replace('<article class="card app"', '<article class="card app featured" aria-label="おすすめ"');
}

// Composition follows the Figma proposal (AWAI-3735): file umqCqP5KSjLWh9fhCI1HaN, page 903:2.
export function renderHtml(store) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>Itonami Store</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<div class="page">
<header class="site-header">
<div class="brand"><img src="logo.png" width="44" height="44" alt=""><span>Itonami Store</span></div>
<span class="org">Awai Network</span>
</header>
<p class="caption">store.itonami.app</p>
<h1>Itonami Store</h1>
<p class="lead">Awai Network のアプリを入手するための入口です。</p>
<nav class="browse" aria-label="このページの案内">
<a href="#apps">アプリ一覧（${store.apps.length} 件）</a>
<a href="#how">入手のしかた</a>
<a href="#verify">取得したファイルを確かめる</a>
<a href="#record">このページの根拠</a>
</nav>
<section class="card notice" aria-labelledby="status">
<h2 id="status">開発版です</h2>
<p>ここに載っているアプリとカタログは、開発用の鍵で署名した開発版です。正式なリリースではありません。${store.trust?.mode === 'key-list' ? '本番の署名鍵はまだありません。' : '本番の署名鍵と、鍵の更新・失効の仕組みはまだありません。'}</p>
</section>
<div class="columns">
<section class="card how" aria-labelledby="how">
<h2 id="how">入手のしかた</h2>
<dl class="stacked">
<div><dt>Awai OS</dt><dd>Itonami Store が入っています。Store を開いてアプリを選びます。</dd></div>
<div><dt>Android</dt><dd>Android 13 以降が必要です。一覧から APK を取得して入れられます。Store 本体の一般向けの配布は準備中です。</dd></div>
<div><dt>iPhone・iPad</dt><dd>提供していません。</dd></div>
<div><dt>Mac・Windows・Linux</dt><dd>提供していません。</dd></div>
</dl>
</section>
<main class="apps" aria-labelledby="apps">
<h2 id="apps">アプリ（${store.apps.length} 件）</h2>
<p class="muted">カタログ revision ${esc(store.revision)}。このページは、あなたがリンクを押すまで外部と通信しません。広告や追跡はなく、取得はあなたが押した時だけです。</p>
${store.apps.length ? `<section class="featured-wrap" aria-label="おすすめ">\n<h3 class="label muted">おすすめ</h3>\n${featuredHtml(store.apps[0])}\n</section>\n<section class="list-wrap" aria-label="アプリ一覧">\n<h3 class="label muted">すべてのアプリ</h3>\n${store.apps.slice(1).map(appHtml).join('\n')}\n</section>` : ''}
</main>
<section class="card verify" aria-labelledby="verify">
<h2 id="verify">取得したファイルを確かめる</h2>
<p>入れる前に、ファイルの SHA-256 と署名者が、一覧の値と同じことを確かめてください。一致しないファイルは入れないでください。</p>
<pre><code>shasum -a 256 取得したファイル.apk
apksigner verify --print-certs 取得したファイル.apk</code></pre>
</section>
<section class="card record" aria-labelledby="record">
<h2 id="record">このページの根拠</h2>
<dl class="stacked small">
<div><dt>署名つきの最新 pointer</dt><dd>sequence ${esc(store.sequence)}、${esc(date(store.pointerExpiresAt))} まで有効</dd></div>
<div><dt>署名つきカタログ</dt><dd>revision ${esc(store.revision)}</dd></div>
<div><dt>固定した commit</dt><dd>${esc(store.sourceRevision)}</dd></div>
${store.trust?.mode === 'key-list'
  ? `<div><dt>鍵の一覧</dt><dd>sequence ${esc(store.trust.sequence)}、${esc(date(store.trust.expiresAt))} まで有効（root ${esc(store.trust.rootSha256.slice(0, 8))}…、開発用）</dd></div>
<div><dt>カタログの署名鍵</dt><dd>${store.trust.catalogKeys.map(k => esc(k.slice(0, 8)) + '…').join('、')}（開発用）</dd></div>`
  : `<div><dt>カタログの署名者</dt><dd>${esc(store.signer.slice(0, 8))}…（開発用の鍵）</dd></div>`}
</dl>
</section>
<a class="button secondary source" href="site-manifest.json">生成元と digest を見る</a>
</div>
<footer><p class="caption">Itonami Store — Awai Network</p>\n<p class="caption">このページに広告や追跡はありません。署名つきカタログの内容だけを表示します。</p></footer>
</div>
</body>
</html>
`;
}

export async function buildSite(input) {
  const store = await verifyStore(input);
  const files = {'index.html': Buffer.from(renderHtml(store), 'utf8'), 'style.css': input.css, 'logo.png': input.logo};
  const manifest = {schema: 'awai.store-site.v1', pointerSequence: store.sequence, catalogRevision: store.revision,
    sourceRevision: store.sourceRevision, signer: store.signer, trust: store.trust, development: true,
    apps: store.apps.map(a => ({id: a.id, publisher: a.publisher, versionCode: a.versionCode, sha256: a.download?.sha256 ?? null, url: a.download?.url ?? null})),
    files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha256(bytes)]))};
  files['site-manifest.json'] = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return {store, files};
}

export function repositoryInput(root, now) {
  return {
    pointerBytes: readFileSync(join(root, 'store/latest/pointer-envelope.json')),
    rootDer: readFileSync(join(root, 'store/keys/store-root.der')),
    keysBytes: readFileSync(join(root, 'store/latest/keys-envelope.json')),
    css: readFileSync(join(root, 'store/site/style.css')),
    logo: readFileSync(join(root, 'store/site/logo.png')),
    read: path => existsSync(join(root, path)) ? readFileSync(join(root, path)) : null,
    now,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
  const out = value('--out');
  if (!out) { console.error('usage: node store/site/build.mjs --out <new dir> [--now <epoch seconds>]'); process.exit(2); }
  if (existsSync(out)) { console.error('destination must be new'); process.exit(2); }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const now = value('--now') ? Number(value('--now')) : Math.floor(Date.now() / 1000);
  const {store, files} = await buildSite(repositoryInput(root, now));
  mkdirSync(out, {recursive: true});
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(out, name), bytes);
  console.log(JSON.stringify({out, sequence: store.sequence, revision: store.revision, apps: store.apps.length,
    downloads: store.apps.filter(a => a.download).length,
    bytesChecked: store.apps.filter(a => a.download?.bytesChecked).length,
    files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha256(bytes)]))}));
}
