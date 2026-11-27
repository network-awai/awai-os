// Static build for Bengoshi (network.itonami.bengoshi).
// Produces a self-contained dist/ bundle ready to publish to https://bengoshi.itonami.app
// (default Web target: `connect-src 'none';`) or Tauri v3 (`--target tauri`: `connect-src ipc: http://ipc.localhost;`).
// Verifies:
// - Canonical kotoba-client-runtime.js & kotoba-client-consent.css SHA-256 against otehon/shell/vendor/PINS.json
// - Descriptor validity via clientRuntimeProblems, exact parity with app-descriptor.json, and `operations: []`
// - Exact Web CSP + `<meta name="referrer" content="no-referrer">` (zero 'unsafe-eval')
// - Zero jp-go-dds / dds.css / dads-* references (AWAI-4144)
// - Synthetic catalog integrity SHA-256 (100% synthetic + .invalid domains)
// - Writes dist/release.json (`awai.app.artifact.v1` with `source_commit`, `dirty`, `versionName`, `versionCode`, `files`)

import { mkdir, copyFile, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const app = fileURLToPath(new URL('../', import.meta.url));
const repo = resolve(app, '../..');
const out = resolve(app, 'dist');
const sha = b => createHash('sha256').update(b).digest('hex');

const isTauriTarget = process.argv.includes('--target') && process.argv[process.argv.indexOf('--target') + 1] === 'tauri';

export const WEB_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const TAURI_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src ipc: http://ipc.localhost; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

const SRC_FILES = [
  'style.css',
  'app.js',
  'model.js',
  'crypto.js',
  'legal-notices.js',
  'operator-disclosure.js',
  'messages.js',
  'runtime-descriptor.js',
  'fixtures.js',
  'operations.js',
  'mcp-embed.js',
  'mcp-adapter.js',
];

function gitMeta() {
  try {
    const commit = process.env.SOURCE_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['status', '--porcelain', '--', 'apps/bengoshi'], { cwd: repo, encoding: 'utf8' })
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.endsWith('apps/bengoshi/dist') && !l.includes('apps/bengoshi/dist/'));
    return { source_commit: commit, dirty: status.length > 0 };
  } catch {
    return { source_commit: 'unknown', dirty: true };
  }
}

const pkg = JSON.parse(await readFile(resolve(app, 'package.json'), 'utf8'));
const git = gitMeta();

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

// Inline 32x32 PNG favicon so WebView never re-requests icon.png on hash navigation.
const iconB64 = (await readFile(resolve(app, 'src-tauri/icons/32x32.png'))).toString('base64');
const srcHtml = await readFile(resolve(app, 'src/index.html'), 'utf8');
if (!srcHtml.includes('href="icon.png"')) throw new Error('index.html icon link missing');
if (/unsafe-eval|jp-go-dds|dds\.css|\bdads-/i.test(srcHtml)) throw new Error('Forbidden CSP or DDS reference in index.html');
if (!srcHtml.includes(`content="${WEB_CSP}"`)) {
  throw new Error(`src/index.html must contain exact Web CSP: ${WEB_CSP}`);
}
if (!srcHtml.includes('<meta name="referrer" content="no-referrer">')) {
  throw new Error('src/index.html must contain <meta name="referrer" content="no-referrer">');
}

let builtHtml = srcHtml.replace('href="icon.png"', `href="data:image/png;base64,${iconB64}"`);
if (isTauriTarget) {
  builtHtml = builtHtml.replace(`content="${WEB_CSP}"`, `content="${TAURI_CSP}"`);
}
await writeFile(resolve(out, 'index.html'), builtHtml, 'utf8');

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

// Verify runtime descriptor, app-descriptor.json parity, and ZERO external operations
const { runtimeDescriptor, REQUESTED_CAPABILITIES } = await import('../src/runtime-descriptor.js');
const { clientRuntimeProblems, clientRuntimeConnectSrc } = await import('../../../otehon/shell/vendor/kotoba-client-runtime.js');

const descriptor = runtimeDescriptor();
if (!Array.isArray(descriptor.operations) || descriptor.operations.length !== 0) {
  throw new Error('app-descriptor.json must declare operations: [] (zero external calls)');
}
const problems = clientRuntimeProblems(descriptor, [...REQUESTED_CAPABILITIES], 'https://bengoshi.itonami.app');
if (problems.length) throw new Error('Invalid runtime descriptor: ' + JSON.stringify(problems));

const derivedConnect = clientRuntimeConnectSrc(descriptor, [...REQUESTED_CAPABILITIES], [], 'https://bengoshi.itonami.app');
if (derivedConnect !== "connect-src 'none'") {
  throw new Error(`Expected connect-src 'none', got: ${derivedConnect}`);
}

const appDescriptorFile = JSON.parse(await readFile(resolve(app, 'app-descriptor.json'), 'utf8'));
if (JSON.stringify(appDescriptorFile) !== JSON.stringify(descriptor)) {
  throw new Error('app-descriptor.json drifted from src/runtime-descriptor.js');
}

const tauriCsp = JSON.parse(await readFile(resolve(app, 'src-tauri/tauri.conf.json'), 'utf8')).app.security.csp;
if (tauriCsp !== TAURI_CSP) {
  throw new Error(`tauri.conf.json CSP mismatch: expected "${TAURI_CSP}"`);
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
      version: pkg.version,
      versionName: pkg.version,
      versionCode: 100,
      source_commit: git.source_commit,
      dirty: git.dirty,
      target: isTauriTarget ? 'tauri' : 'web',
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

console.log(`Bengoshi static build (${isTauriTarget ? 'tauri' : 'web'}): ${Object.keys(files).length} pinned files -> apps/bengoshi/dist/`);
