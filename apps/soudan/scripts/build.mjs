// Static build:
// - Default (`npm run build` / `--target web`): outputs Web static `dist/` for https://soudan.itonami.app
//   with `connect-src 'none';` in ALL standalone HTML files (index.html, foreign-info.html, embed.html),
//   plus self-contained single-file `guest.html` for canonical `mountRestrictedClientApp` (restricted-wasm-v1),
//   zero symlinks, strictly < 10 MiB per file (NAME_PLANE_MAX_FILE_BLOCKS=40), and dist/release.json.
// - Tauri (`npm run build:tauri` / `--target tauri`): outputs Tauri frontend `dist-tauri/` where
//   index.html carries `connect-src ipc: http://ipc.localhost;` (required because WebView intersects HTML
//   <meta CSP> with tauri.conf.json app.security.csp) while foreign-info.html & embed.html keep `connect-src 'none';`.
import {distributeUi} from '../../../packages/awai-ui/distribute.mjs';
import {mkdir, copyFile, readFile, writeFile, readdir, lstat, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // strictly < 10 MiB (yataverse-bytes 40-block cap)
const MAX_GUEST_HTML_BYTES = 8 * 1024 * 1024; // mountRestrictedClientApp 8388608 char budget
const args = process.argv.slice(2);
const targetIdx = args.indexOf('--target');
const target = targetIdx >= 0 ? args[targetIdx + 1] : 'web';
if (!['web', 'tauri'].includes(target)) {
  throw Error(`unsupported build target: ${target} (expected web or tauri)`);
}

const app = fileURLToPath(new URL('../', import.meta.url));
const repo = resolve(app, '../..');
const out = resolve(app, target === 'tauri' ? 'dist-tauri' : 'dist');
const sha = b => createHash('sha256').update(b).digest('hex');

await rm(out, {recursive: true, force: true});
await mkdir(out, {recursive: true});

const srcModules = [
  'style.css', 'app.js', 'embed.js', 'model.js', 'messages.js',
  'operations.js', 'send.js', 'inference.js', 'semantic.js', 'mcp-app.js',
  'storage.js', 'form-session.js', 'guest-entry.js',
];
for (const name of srcModules) {
  await copyFile(resolve(app, 'src', name), resolve(out, name));
}
await copyFile(resolve(repo, 'packages/awai-shell/host.js'), resolve(out, 'host.js'));

// Inline icon into index.html (Android WebView re-requests linked icons on URL/hash changes).
const icon = 'data:image/png;base64,' + (await readFile(resolve(app, 'src-tauri/icons/32x32.png'))).toString('base64');
const rawIndexHtml = await readFile(resolve(app, 'src/index.html'), 'utf8');
if (!rawIndexHtml.includes('href="icon.png"')) throw Error('index.html icon link missing');
if (!rawIndexHtml.includes("connect-src 'none';")) throw Error("src/index.html must default to connect-src 'none';");
const indexHtml = target === 'tauri'
  ? rawIndexHtml.replace("connect-src 'none';", 'connect-src ipc: http://ipc.localhost;')
  : rawIndexHtml;
await writeFile(resolve(out, 'index.html'), indexHtml.replace('href="icon.png"', `href="${icon}"`));

// Copy static routes (no SPA fallback). Both foreign-info.html and embed.html always keep connect-src 'none'.
for (const htmlFile of ['foreign-info.html', 'embed.html']) {
  await copyFile(resolve(app, 'src', htmlFile), resolve(out, htmlFile));
}

// Build genuinely self-contained single-file restricted-wasm-v1 guest entry (`guest.html`) with
// zero external <script src> / <link href> and zero direct localStorage startup dependency.
function stripModuleSyntax(code) {
  return code
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '')
    .replace(/^export\s+\{[^}]+\};\s*$/gm, '')
    .replace(/^export\s+(?=(?:const|let|var|async\s+function|function|class)\b)/gm, '');
}
const guestOrder = ['messages.js', 'model.js', 'operations.js', 'send.js', 'inference.js', 'semantic.js', 'storage.js', 'guest-entry.js'];
const guestParts = [];
for (const name of guestOrder) {
  guestParts.push(`// --- ${name} ---\n` + stripModuleSyntax(await readFile(resolve(app, 'src', name), 'utf8')));
}
const guestScript = `(function(){\n'use strict';\n${guestParts.join('\n')}\n})();`;
// Validate bundled JS syntax at build time.
new Function(guestScript);
const styleCss = await readFile(resolve(app, 'src/style.css'), 'utf8');
const guestHtml = [
  '<!doctype html>',
  '<html lang="ja">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
  '  <meta name="color-scheme" content="light dark">',
  '  <meta name="referrer" content="no-referrer">',
  '  <title>Soudan — 自己整理メモツール (restricted-wasm-v1)</title>',
  `  <style>${styleCss.replace(/<\/style/gi, '<\\/style')}</style>`,
  '</head>',
  '<body>',
  '  <main id="guest-root" data-semantic-state="idle">',
  '    <header class="app-header"><h1>Soudan — 自己整理メモツール</h1></header>',
  '    <div id="view"></div>',
  '    <p id="status" role="status" aria-live="polite"></p>',
  '  </main>',
  `  <script>${guestScript.replace(/<\/script/gi, '<\\/script')}</script>`,
  '</body>',
  '</html>',
  '',
].join('\n');
if (/<script[^>]+src=|<link[^>]+rel=['"]stylesheet['"]/i.test(guestHtml)) {
  throw Error('guest.html must be self-contained with zero external script/stylesheet links');
}
if (Buffer.byteLength(guestHtml, 'utf8') > MAX_GUEST_HTML_BYTES) {
  throw Error('guest.html exceeds mountRestrictedClientApp 8 MiB budget');
}
await writeFile(resolve(out, 'guest.html'), guestHtml);

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
if (descriptor.entry !== 'guest.html') throw Error('descriptor entry must point to self-contained guest.html');
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
// - Web static HTML (dist/index.html, embed.html, foreign-info.html) MUST use connect-src 'none'
// - Tauri CSP (tauri.conf.json & dist-tauri/index.html) MUST use connect-src ipc: http://ipc.localhost;
const tauriConf = JSON.parse(await readFile(resolve(app, 'src-tauri/tauri.conf.json'), 'utf8'));
const tauriCsp = tauriConf.app.security.csp;
if (!tauriCsp.includes('connect-src ipc: http://ipc.localhost;')) {
  throw Error('tauri.conf.json CSP connect-src must be IPC only');
}
if (/https?:\/\/api\.murakumo\.cloud/i.test(tauriCsp)) {
  throw Error('tauri.conf.json CSP must not allow external origins for offline-default build');
}
if (tauriConf.build.frontendDist !== '../dist-tauri') {
  throw Error('tauri.conf.json frontendDist must point to ../dist-tauri');
}
await writeFile(resolve(out, 'descriptor.json'), JSON.stringify(descriptor, null, 2) + '\n');
await distributeUi(out);

// Verify every standalone HTML entry in output directory has mandatory <meta> CSP + referrer=no-referrer.
for (const htmlFile of ['index.html', 'foreign-info.html', 'embed.html']) {
  const body = await readFile(resolve(out, htmlFile), 'utf8');
  if (!body.includes('http-equiv="Content-Security-Policy"')) throw Error('missing meta CSP in ' + htmlFile);
  if (!body.includes('name="referrer" content="no-referrer"')) throw Error('missing meta no-referrer in ' + htmlFile);
  if (body.includes('https://soudan.itonami.app/api')) throw Error('app-origin API reference in ' + htmlFile);
  if (/https?:\/\/api\.murakumo\.cloud/i.test(body.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '')) {
    throw Error('HTML meta CSP must not widen to api.murakumo.cloud while inference is fail-closed: ' + htmlFile);
  }
  if (target === 'tauri' && htmlFile === 'index.html') {
    if (!body.includes('connect-src ipc: http://ipc.localhost;')) {
      throw Error('Tauri dist-tauri/index.html must allow Tauri IPC connect-src');
    }
  } else {
    if (!body.includes("connect-src 'none';")) {
      throw Error(`HTML must use connect-src 'none' for target=${target}: ${htmlFile}`);
    }
    if (/connect-src[^"]*ipc:/i.test(body)) {
      throw Error(`Web HTML must not include ipc: in connect-src: ${htmlFile}`);
    }
  }
}

// Walk output dir, refuse symlinks, enforce < 10 MiB per file cap, compute per-file SHA-256.
async function list(dir, rel = '') {
  const result = [];
  for (const e of await readdir(resolve(dir, rel), {withFileTypes: true})) {
    const n = rel ? rel + '/' + e.name : e.name;
    const full = resolve(dir, n);
    const st = await lstat(full);
    if (st.isSymbolicLink()) throw Error('symlink forbidden in output: ' + n);
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
  target,
  profile: 'restricted-wasm-v1',
  host: 'awai.shell.host.v1',
  tauri: '3.0.0-alpha.6',
  source_commit: sourceCommit,
  dirty,
  files,
}, null, 2) + '\n');

console.log(`Soudan ${target} build (${target === 'tauri' ? 'dist-tauri/' : 'dist/'}): ${Object.keys(files).length} pinned files (profile=restricted-wasm-v1, dirty=${dirty})`);
