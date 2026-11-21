#!/usr/bin/env node
// Build the static Itonami Store entry page (AWAI-3730) from the signed latest pointer.
//
// The page is a document: HTML and CSS, no script, no request-time handler. Every listed
// download is a commit-pinned URL with its SHA-256, taken from the signed pointer and catalog.
// Nothing is listed unless the pointer signature, the catalog signature, the pins and the
// local bytes all agree. Development signer only: there is no production key yet.
//
//   node store/site/build.mjs --out <new dir> [--now <epoch seconds>]
import {createHash, createPublicKey, verify, X509Certificate} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const DEV_SIGNER = '2507930b6c21b3c1cd0655527227dba75772096eff85e887bfcce2fb25b49b29';
const PIN_URL = /^https:\/\/raw\.githubusercontent\.com\/network-awai\/awai-os\/([0-9a-f]{40})\/(store\/distribution\/[A-Za-z0-9._\/-]+)$/;
const MAX_LIFETIME = 31 * 24 * 60 * 60;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
const esc = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

function signerKey(pem, expected) {
  const cert = new X509Certificate(pem);
  if (sha256(cert.raw) !== expected) fail('signer-fingerprint');
  return createPublicKey(cert.publicKey.export({type: 'spki', format: 'pem'}));
}

function openEnvelope(bytes, key, code) {
  const envelope = JSON.parse(bytes.toString('utf8'));
  if (Object.keys(envelope).sort().join() !== 'raw,signature') fail(code + '-shape');
  if (typeof envelope.raw !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(envelope.signature)) fail(code + '-shape');
  if (!verify('RSA-SHA256', Buffer.from(envelope.raw, 'utf8'), key, Buffer.from(envelope.signature, 'base64'))) fail(code + '-signature');
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
export function verifyStore({pointerBytes, signerPem, read, now, signer = DEV_SIGNER}) {
  const key = signerKey(signerPem, signer);
  const pointer = openEnvelope(pointerBytes, key, 'pointer');
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
  const catalog = openEnvelope(catalogBytes, key, 'catalog');
  if (catalog.schema !== 'itonami.store.bundled.v1') fail('catalog-schema');
  if (!Number.isSafeInteger(catalog.revision) || !Array.isArray(catalog.apps)) fail('catalog-shape');
  if (!Number.isSafeInteger(catalog.expiresAt) || now >= catalog.expiresAt) fail('catalog-expired');

  const listed = new Set();
  const apps = catalog.apps.map(app => {
    if (!/^network\.(itonami|awai)\.[a-z0-9.]+$/.test(app.id) || listed.has(app.id)) fail('app-id');
    listed.add(app.id);
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
    return {id: app.id, name: String(app.name), description: String(app.description || ''), publisher: String(app.publisher || ''),
      versionName: String(app.versionName), versionCode: app.versionCode,
      operations: Array.isArray(app.operations) ? app.operations.length : null, download};
  });
  for (const id of Object.keys(pins.apks)) if (!listed.has(id)) fail('apk-pin-unlisted');
  return {sequence: pointer.sequence, pointerExpiresAt: pointer.expiresAt, revision: catalog.revision,
    catalogExpiresAt: catalog.expiresAt, sourceRevision: pins.revision, signer, apps};
}

function appHtml(app) {
  const d = app.download;
  const operations = app.operations === null ? '記載なし' : app.operations === 0 ? 'なし' : `${app.operations} 件（アプリ内で、通信のたびに確認します）`;
  const rows = [
    ['パッケージ', `<code>${esc(app.id)}</code>`],
    ['版', `${esc(app.versionName)}（versionCode ${esc(app.versionCode)}）`],
    ['発行者', esc(app.publisher)],
    ['外部との通信の宣言', operations],
  ];
  if (d) rows.push(['大きさ', `${esc(size(d.bytes))}（${esc(d.bytes)} bytes）`],
    ['SHA-256', `<code>${esc(d.sha256)}</code>`],
    ['署名者の証明書', `<code>${esc(d.signerSha256)}</code>${d.developmentSigner ? '（開発用の鍵）' : '（リリース用の鍵）'}`]);
  const action = d
    ? `<p><a class="download" href="${esc(d.url)}" rel="noreferrer" download>APK を取得（raw.githubusercontent.com）</a></p>`
    : '<p class="note">Android 向けの APK は公開していません。</p>';
  return `<article class="app" id="${esc(app.id)}">
<h3>${esc(app.name)}</h3>
<p>${esc(app.description)}</p>
<dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
${action}
</article>`;
}

export function renderHtml(store) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>Itonami Store</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
<h1>Itonami Store</h1>
<p>Awai Network のアプリを入手するための入口です。</p>
</header>
<main>
<section class="notice" aria-labelledby="status">
<h2 id="status">開発版です</h2>
<p>ここに載っているアプリとカタログは、開発用の鍵で署名した開発版です。正式なリリースではありません。本番の署名鍵と、鍵の更新・失効の仕組みはまだありません。</p>
</section>
<section aria-labelledby="how">
<h2 id="how">入手のしかた</h2>
<dl class="platforms">
<div><dt>Awai OS</dt><dd>Itonami Store が入っています。Store を開いてアプリを選びます。</dd></div>
<div><dt>Android</dt><dd>Android 15 以降が必要です。下の一覧から APK を取得して入れられます。Store 本体の一般向けの配布は準備中です。</dd></div>
<div><dt>iPhone・iPad</dt><dd>提供していません。</dd></div>
<div><dt>Mac・Windows・Linux</dt><dd>提供していません。</dd></div>
</dl>
</section>
<section aria-labelledby="apps">
<h2 id="apps">アプリ（${store.apps.length} 件）</h2>
<p>カタログ revision ${esc(store.revision)}。リンク先は GitHub（raw.githubusercontent.com）の、commit を固定した変わらないファイルです。このページは、あなたがリンクを押すまで外部と通信しません。</p>
${store.apps.map(appHtml).join('\n')}
</section>
<section aria-labelledby="verify">
<h2 id="verify">取得したファイルを確かめる</h2>
<p>入れる前に、ファイルの SHA-256 が上の値と同じことを確かめてください。</p>
<pre><code>shasum -a 256 取得したファイル.apk
apksigner verify --print-certs 取得したファイル.apk</code></pre>
<p>1 行目の結果が「SHA-256」と、2 行目の certificate SHA-256 digest が「署名者の証明書」と一致すれば、このページが示すファイルと同じです。一致しないファイルは入れないでください。</p>
</section>
<section aria-labelledby="record">
<h2 id="record">このページの根拠</h2>
<dl>
<div><dt>署名つきの最新 pointer</dt><dd>sequence ${esc(store.sequence)}、${esc(date(store.pointerExpiresAt))} まで有効</dd></div>
<div><dt>署名つきカタログ</dt><dd>revision ${esc(store.revision)}、${esc(date(store.catalogExpiresAt))} まで有効</dd></div>
<div><dt>固定した commit</dt><dd><code>${esc(store.sourceRevision)}</code></dd></div>
<div><dt>カタログの署名者</dt><dd><code>${esc(store.signer)}</code>（開発用の鍵）</dd></div>
</dl>
<p>このページは <a href="https://github.com/network-awai/awai-os/tree/main/store" rel="noreferrer">network-awai/awai-os の <code>store/</code></a> から、署名と digest を検証したうえで生成しています。ファイルごとの digest は <a href="site-manifest.json">site-manifest.json</a> にあります。</p>
</section>
</main>
<footer><p>Itonami Store — Awai Network</p></footer>
</body>
</html>
`;
}

export function buildSite(input) {
  const store = verifyStore(input);
  const files = {'index.html': Buffer.from(renderHtml(store), 'utf8'), 'style.css': input.css};
  const manifest = {schema: 'awai.store-site.v1', pointerSequence: store.sequence, catalogRevision: store.revision,
    sourceRevision: store.sourceRevision, signer: store.signer, development: true,
    apps: store.apps.map(a => ({id: a.id, versionCode: a.versionCode, sha256: a.download?.sha256 ?? null, url: a.download?.url ?? null})),
    files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha256(bytes)]))};
  files['site-manifest.json'] = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return {store, files};
}

export function repositoryInput(root, now) {
  return {
    pointerBytes: readFileSync(join(root, 'store/latest/pointer-envelope.json')),
    signerPem: readFileSync(join(root, 'store/keys/dev-catalog-signer.pem')),
    css: readFileSync(join(root, 'store/site/style.css')),
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
  const {store, files} = buildSite(repositoryInput(root, now));
  mkdirSync(out, {recursive: true});
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(out, name), bytes);
  console.log(JSON.stringify({out, sequence: store.sequence, revision: store.revision, apps: store.apps.length,
    downloads: store.apps.filter(a => a.download).length,
    bytesChecked: store.apps.filter(a => a.download?.bytesChecked).length,
    files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha256(bytes)]))}));
}
