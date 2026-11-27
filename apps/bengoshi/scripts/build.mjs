// Static build for Bengoshi (network.itonami.bengoshi).
// Produces a self-contained dist/ bundle ready to publish to https://bengoshi.itonami.app
// and packaged by Tauri v3 (src-tauri/tauri.conf.json frontendDist: "../dist").
// Verifies:
// - Canonical kotoba-client-runtime.js & kotoba-client-consent.css SHA-256 against otehon/shell/vendor/PINS.json
// - Descriptor validity via clientRuntimeProblems & exact parity with app-descriptor.json
// - CSP connect-src derivation matching both index.html and src-tauri/tauri.conf.json (no 'unsafe-eval')
// - Zero jp-go-dds / dds.css / dads-* references (AWAI-4144)
// - Synthetic catalog integrity SHA-256
// - Writes dist/release.json (awai.app.artifact.v1) pinning every file in dist/

import { mkdir, copyFile, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const app = fileURLToPath(new URL('../', import.meta.url));
const repo = resolve(app, '../..');
const out = resolve(app, 'dist');
const sha = b => createHash('sha256').update(b).digest('hex');

const SRC_FILES = [
  'style.css',
  'app.js',
  'model.js',
  'crypto.js',
  'legal-notices.js',
  'messages.js',
  'runtime-descriptor.js',
  'fixtures.js',
  'operations.js',
  'mcp-embed.js',
  'mcp-acp-adapter.js',
];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const name of SRC_FILES) {
  const raw = await readFile(resolve(app, 'src', name), 'utf8');
  if (/jp-go-dds|dds\.css|\bdads-/i.test(raw)) {
    throw new Error(`Forbidden jp-go-dds / dads- reference in src/${name}`);
  }
  await writeFile(resolve(out, name), raw, 'utf8');
}

await copyFile(resolve(repo, 'packages/awai-shell/host.js'), resolve(out, 'host.js'));

// Inline 32x32 PNG favicon so Android WebView never re-requests icon.png on hash navigation.
const iconB64 = (await readFile(resolve(app, 'src-tauri/icons/32x32.png'))).toString('base64');
const html = await readFile(resolve(app, 'src/index.html'), 'utf8');
if (!html.includes('href="icon.png"')) throw new Error('index.html icon link missing');
if (/unsafe-eval|jp-go-dds|dds\.css|\bdads-/i.test(html)) throw new Error('Forbidden CSP or DDS reference in index.html');
await writeFile(resolve(out, 'index.html'), html.replace('href="icon.png"', `href="data:image/png;base64,${iconB64}"`));

// Verify canonical Kotoba client runtime pin against otehon/shell/vendor/PINS.json
const pins = JSON.parse(await readFile(resolve(repo, 'otehon/shell/vendor/PINS.json'), 'utf8'));
for (const [input, output] of [['kotoba-client-runtime.js', 'runtime.js'], ['kotoba-client-consent.css', 'runtime-consent.css']]) {
  const bytes = await readFile(resolve(repo, 'otehon/shell/vendor', input));
  if (sha(bytes) !== pins.files[input]) {
    throw new Error(`Canonical runtime pin drift for ${input}`);
  }
  await writeFile(resolve(out, output), bytes);
}

// Verify synthetic fixture bundle integrity
const { verifySyntheticCatalogIntegrity, SYNTHETIC_CATALOG_BUNDLE } = await import('../src/fixtures.js');
const catalogCheck = verifySyntheticCatalogIntegrity();
if (!catalogCheck.ok) throw new Error('Synthetic catalog integrity mismatch');

// Verify runtime descriptor, app-descriptor.json parity, and CSP connect-src
const { runtimeDescriptor, REQUESTED_CAPABILITIES } = await import('../src/runtime-descriptor.js');
const { clientRuntimeProblems, clientRuntimeConnectSrc } = await import('../../../otehon/shell/vendor/kotoba-client-runtime.js');

const descriptor = runtimeDescriptor('ja');
const problems = clientRuntimeProblems(descriptor, [...REQUESTED_CAPABILITIES], 'http://tauri.localhost');
if (problems.length) throw new Error('Invalid runtime descriptor: ' + JSON.stringify(problems));

const appDescriptorFile = JSON.parse(await readFile(resolve(app, 'app-descriptor.json'), 'utf8'));
if (JSON.stringify(appDescriptorFile) !== JSON.stringify(descriptor)) {
  throw new Error('app-descriptor.json drifted from src/runtime-descriptor.js');
}

const derivedConnect = clientRuntimeConnectSrc(descriptor, [...REQUESTED_CAPABILITIES], [], 'http://tauri.localhost');
const expectedCspConnect = `connect-src ipc: http://ipc.localhost ${derivedConnect.slice('connect-src '.length)};`;
const tauriCsp = JSON.parse(await readFile(resolve(app, 'src-tauri/tauri.conf.json'), 'utf8')).app.security.csp;
for (const [name, csp] of [['index.html', html], ['tauri.conf.json', tauriCsp]]) {
  if (/unsafe-eval/i.test(csp)) throw new Error(`unsafe-eval forbidden in ${name}`);
  if (!csp.includes(expectedCspConnect)) {
    throw new Error(`CSP connect-src mismatch in ${name}: expected "${expectedCspConnect}"`);
  }
}

await writeFile(resolve(out, 'descriptor.json'), JSON.stringify(descriptor, null, 2) + '\n');
await writeFile(resolve(out, 'app-descriptor.json'), JSON.stringify(descriptor, null, 2) + '\n');

async function listFiles(dir, rel = '') {
  const result = [];
  for (const entry of await readdir(resolve(dir, rel), { withFileTypes: true })) {
    const n = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await listFiles(dir, n));
    else if (entry.isFile() && n !== 'release.json') result.push(n);
  }
  return result.sort();
}

const files = {};
for (const n of await listFiles(out)) {
  files[n] = sha(await readFile(resolve(out, n)));
}

await writeFile(
  resolve(out, 'release.json'),
  JSON.stringify(
    {
      schema: 'awai.app.artifact.v1',
      id: 'network.itonami.bengoshi',
      version: '0.1.0',
      host: 'awai.shell.host.v1',
      tauri: '3.0.0-alpha.6',
      runtimePinRevision: pins.revision,
      syntheticCatalogSha256: SYNTHETIC_CATALOG_BUNDLE.digestSha256,
      releaseGate: 'gated-on-legal-review-and-o10',
      files,
    },
    null,
    2,
  ) + '\n',
);

console.log(`Bengoshi static build: ${Object.keys(files).length} pinned files -> apps/bengoshi/dist/`);
