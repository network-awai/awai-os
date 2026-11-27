// Static build: dist/ holds every file the app needs, each pinned in release.json.
// Enforces yataverse-bytes static delivery constraints:
// - Mandatory HTML <meta> CSP + referrer=no-referrer on every HTML route
// - No SPA fallback: index.html, foreign-info.html, embed.html exist as real static files (zero symlinks)
// - Every file strictly < 10 MiB (NAME_PLANE_MAX_FILE_BLOCKS=40)
// - Canonical runtime pin verification + restricted-wasm-v1 descriptor verification
import {distributeUi} from '../../../packages/awai-ui/distribute.mjs';
import {mkdir, copyFile, readFile, writeFile, readdir, lstat, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // strictly < 10 MiB (yataverse-bytes 40-block cap)
const app = fileURLToPath(new URL('../', import.meta.url));
const repo = resolve(app, '../..');
const out = resolve(app, 'dist');
const sha = b => createHash('sha256').update(b).digest('hex');

await rm(out, {recursive: true, force: true});
await mkdir(out, {recursive: true});

const srcModules = [
  'style.css', 'app.js', 'embed.js', 'model.js', 'messages.js',
  'operations.js', 'send.js', 'inference.js', 'semantic.js', 'mcp-app.js',
];
for (const name of srcModules) {
  await copyFile(resolve(app, 'src', name), resolve(out, name));
}
await copyFile(resolve(repo, 'packages/awai-shell/host.js'), resolve(out, 'host.js'));

// Inline icon into index.html (Android WebView re-requests linked icons on URL/hash changes).
const icon = 'data:image/png;base64,' + (await readFile(resolve(app, 'src-tauri/icons/32x32.png'))).toString('base64');
const indexHtml = await readFile(resolve(app, 'src/index.html'), 'utf8');
if (!indexHtml.includes('href="icon.png"')) throw Error('index.html icon link missing');
await writeFile(resolve(out, 'index.html'), indexHtml.replace('href="icon.png"', `href="${icon}"`));

// Copy static routes (no SPA fallback).
for (const htmlFile of ['foreign-info.html', 'embed.html']) {
  await copyFile(resolve(app, 'src', htmlFile), resolve(out, htmlFile));
}

// Pin canonical kotoba-client-runtime.js + kotoba-client-consent.css against otehon/shell/vendor/PINS.json.
const pins = JSON.parse(await readFile(resolve(repo, 'otehon/shell/vendor/PINS.json'), 'utf8'));
for (const [input, output] of [['kotoba-client-runtime.js', 'runtime.js'], ['kotoba-client-consent.css', 'runtime-consent.css']]) {
  const bytes = await readFile(resolve(repo, 'otehon/shell/vendor', input));
  if (sha(bytes) !== pins.files[input]) throw Error('canonical runtime pin drift: ' + input);
  await writeFile(resolve(out, output), bytes);
}

// Verify checked-in app-descriptor.json matches runtimeDescriptor('ja') and validates cleanly.
const {runtimeDescriptor, REQUESTED_CAPABILITIES, SEND_SELECTOR, INFERENCE_SELECTOR} = await import('../src/operations.js');
const {clientRuntimeProblems, clientRuntimeConnectSrc} = await import('../../../otehon/shell/vendor/kotoba-client-runtime.js');
const descriptor = runtimeDescriptor('ja');
const checkedIn = JSON.parse(await readFile(resolve(app, 'app-descriptor.json'), 'utf8'));
if (JSON.stringify(checkedIn) !== JSON.stringify(descriptor)) {
  throw Error('app-descriptor.json drifted from src/operations.js runtimeDescriptor("ja")');
}
const appOrigins = ['https://soudan.itonami.app', 'http://tauri.localhost', 'https://tauri.localhost'];
const problems = clientRuntimeProblems(descriptor, [...REQUESTED_CAPABILITIES], appOrigins);
if (problems.length) throw Error('invalid runtime descriptor: ' + JSON.stringify(problems));
if (descriptor.profile !== 'restricted-wasm-v1') throw Error('descriptor profile must be restricted-wasm-v1');
if (descriptor.operations.length !== 2
  || descriptor.operations[0].capability !== SEND_SELECTOR.capability
  || descriptor.operations[1].capability !== INFERENCE_SELECTOR.capability) {
  throw Error('unexpected operations in descriptor');
}

const declaredConnect = clientRuntimeConnectSrc(descriptor, [...REQUESTED_CAPABILITIES], [], appOrigins);
if (declaredConnect !== 'connect-src https://api.murakumo.cloud') {
  throw Error('unexpected connect-src from descriptor: ' + declaredConnect);
}
// Independent CSP checks (Dev #220 + Itonami):
// - Web static HTML (dist/*.html) MUST use connect-src 'none' (zero network destinations while inference is fail-closed)
// - Tauri CSP (tauri.conf.json) keeps Tauri IPC only (connect-src ipc: http://ipc.localhost;)
const tauriCsp = JSON.parse(await readFile(resolve(app, 'src-tauri/tauri.conf.json'), 'utf8')).app.security.csp;
if (!tauriCsp.includes('connect-src ipc: http://ipc.localhost;')) {
  throw Error('tauri.conf.json CSP connect-src must be IPC only');
}
if (/https?:\/\/api\.murakumo\.cloud/i.test(tauriCsp)) {
  throw Error('tauri.conf.json CSP must not allow external origins for offline-default build');
}
await writeFile(resolve(out, 'descriptor.json'), JSON.stringify(descriptor, null, 2) + '\n');
await distributeUi(out);

// Verify every HTML entry in dist/ has mandatory <meta> CSP with connect-src 'none' + referrer=no-referrer.
for (const htmlFile of ['index.html', 'foreign-info.html', 'embed.html']) {
  const body = await readFile(resolve(out, htmlFile), 'utf8');
  if (!body.includes('http-equiv="Content-Security-Policy"')) throw Error('missing meta CSP in ' + htmlFile);
  if (!body.includes("connect-src 'none';")) throw Error("Web static HTML must use connect-src 'none': " + htmlFile);
  if (!body.includes('name="referrer" content="no-referrer"')) throw Error('missing meta no-referrer in ' + htmlFile);
  if (body.includes('https://soudan.itonami.app/api')) throw Error('app-origin API reference in ' + htmlFile);
}

// Walk dist/, refuse symlinks, enforce < 10 MiB per file cap, compute per-file SHA-256.
async function list(dir, rel = '') {
  const result = [];
  for (const e of await readdir(resolve(dir, rel), {withFileTypes: true})) {
    const n = rel ? rel + '/' + e.name : e.name;
    const full = resolve(dir, n);
    const st = await lstat(full);
    if (st.isSymbolicLink()) throw Error('symlink forbidden in dist/: ' + n);
    if (st.isDirectory()) result.push(...await list(dir, n));
    else if (st.isFile() && n !== 'release.json') {
      if (st.size >= MAX_FILE_BYTES) throw Error(`file exceeds 10 MiB cap (${st.size} bytes): ${n}`);
      result.push(n);
    }
  }
  return result.sort();
}

const files = {};
for (const n of await list(out)) files[n] = sha(await readFile(resolve(out, n)));

let sourceCommit = null;
let dirty = null;
try {
  sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim();
  const st = execFileSync('git', ['status', '--porcelain', '--', 'apps/soudan'], {cwd: repo, encoding: 'utf8'}).trim();
  dirty = st.length > 0;
} catch {}

await writeFile(resolve(out, 'release.json'), JSON.stringify({
  schema: 'awai.app.artifact.v1',
  id: 'network.itonami.soudan',
  version: '0.1.0',
  profile: 'restricted-wasm-v1',
  host: 'awai.shell.host.v1',
  tauri: '3.0.0-alpha.6',
  source_commit: sourceCommit,
  dirty,
  files,
}, null, 2) + '\n');

console.log(`Soudan static build: ${Object.keys(files).length} pinned files (profile=restricted-wasm-v1, dirty=${dirty})`);
