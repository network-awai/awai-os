// Public hygiene, legal compliance & architecture gate for apps/soudan.
// Fails immediately if any prohibited Attorney Act / Ad Regs term, false non-retention claim,
// murakumo/free target, native form submit, jp-go-dds, IDE ACP, window.openai, 7-barrier violation,
// or runtime/manifest drift appears.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const app = fileURLToPath(new URL('../', import.meta.url));
const repo = resolve(app, '../..');
const sha = b => createHash('sha256').update(b).digest('hex');

const failures = [];
const fail = msg => failures.push(msg);

// 1. Attorney Act Art. 74(2) & Ad Regs Art. 3/4/8 naming/copy rule across user-facing copy & metadata.
const PROHIBITED_AD_RE = [
  ['弁護士マッチング', /弁護士マッチング/u],
  ['紹介', /紹介/u],
  ['専門/専門家', /専門/u],
  ['スペシャリスト', /スペシャリスト/u],
  ['プロ (ad claim)', /プロ(?!バイダ|トコル|フィール|グラム|キシ|セス)/u],
  ['エキスパート', /エキスパート/u],
  ['勝訴率', /勝訴率/u],
  ['解決件数', /解決件数/u],
  ['口コミ', /口コミ/u],
  ['星評価', /星(?:評価|[0-9０-９★☆])/u],
  ['必ず解決', /必ず解決/u],
  ['すぐ解決', /すぐ解決/u],
  ['運営者名義法律相談', /運営者名義で法律相談|当サービスが法律相談を受け付け/u],
];

const COPY_FILES = [
  'src/messages.js',
  'src/index.html',
  'src/embed.html',
  'src/foreign-info.html',
  'app-descriptor.json',
  'blueprint.edn',
  'src-tauri/tauri.conf.json',
  'src-tauri/gen/android/app/src/main/res/values/strings.xml',
];

for (const rel of COPY_FILES) {
  const content = await readFile(resolve(app, rel), 'utf8');
  for (const [label, re] of PROHIBITED_AD_RE) {
    if (re.test(content)) fail(`prohibited Attorney Act / Ad Regs term (${label}) in ${rel}`);
  }
}

// 2. Anti-false-disclosure rule (Legal item #224 Route B): NEVER claim fixed JP-only or zero retention.
const FALSE_DISCLOSURE_RE = [
  ['ログ不保存', /ログ不保存/u],
  ['完全非保持', /完全非保持/u],
  ['ゼロ保持', /ゼロ保持/u],
  ['日本国内限定', /日本国内限定/u],
];

const ALL_PUBLIC_FILES = [
  ...COPY_FILES,
  'README.md',
  'src/app.js',
  'src/embed.js',
  'src/model.js',
  'src/operations.js',
  'src/send.js',
  'src/inference.js',
  'src/semantic.js',
  'src/mcp-app.js',
  'src/style.css',
];

for (const rel of ALL_PUBLIC_FILES) {
  const content = await readFile(resolve(app, rel), 'utf8');
  for (const [label, re] of FALSE_DISCLOSURE_RE) {
    if (re.test(content)) fail(`prohibited false-disclosure claim (${label}) in ${rel}`);
  }
}

// 3. No murakumo/free anywhere in runtime/descriptor/HTML/UI (only inference.js guard tests/rejects it).
for (const rel of ['app-descriptor.json', 'src/operations.js', 'src/app.js', 'src/index.html', 'src/embed.html', 'src/foreign-info.html']) {
  const content = await readFile(resolve(app, rel), 'utf8');
  if (/murakumo\/free/i.test(content)) fail(`forbidden murakumo/free reference in ${rel}`);
}

// 4. Sandbox allow-scripts compliance, no jp-go-dds, no window.openai, no IDE ACP, no 7-barrier links, no Government Request Portals.
const SRC_FILES = [
  'src/index.html', 'src/embed.html', 'src/foreign-info.html', 'src/style.css',
  'src/app.js', 'src/embed.js', 'src/model.js', 'src/messages.js',
  'src/operations.js', 'src/send.js', 'src/inference.js', 'src/semantic.js', 'src/mcp-app.js',
];

for (const rel of SRC_FILES) {
  const content = await readFile(resolve(app, rel), 'utf8');
  if (/jp-go-dds/i.test(content)) fail(`forbidden jp-go-dds in ${rel}`);
  if (/window\.openai/i.test(content)) fail(`forbidden window.openai in ${rel}`);
  if (/agent-client-protocol|ide[-_\s]?acp/i.test(content)) fail(`forbidden IDE ACP reference in ${rel}`);
  if (/Government Request/i.test(content)) fail(`forbidden Government Request Portal in ${rel}`);
  if (/portal/i.test(content)) fail(`forbidden portal reference in ${rel}`);
  if (/lawfirm-admin|x402|saifu|murakumo\.cloud\/(?:billing|credits|pricing)/i.test(content)) {
    fail(`7-barrier violation (paid SaaS / token / billing link) in ${rel}`);
  }
  if (/type\s*=\s*['"]submit['"]|addEventListener\(\s*['"]submit['"]|\.requestSubmit\s*\(/i.test(content)) {
    fail(`sandbox="allow-scripts" native form submit violation in ${rel}`);
  }
}

// 5. Mandatory HTML <meta> CSP & referrer=no-referrer in every HTML file.
for (const rel of ['src/index.html', 'src/embed.html', 'src/foreign-info.html']) {
  const content = await readFile(resolve(app, rel), 'utf8');
  if (!content.includes('http-equiv="Content-Security-Policy"')) fail(`missing meta CSP in ${rel}`);
  if (!content.includes('name="referrer" content="no-referrer"')) fail(`missing meta no-referrer in ${rel}`);
}

// 6. blueprint.edn single classification key & SPDX + NOTICE presence.
const blueprint = await readFile(resolve(app, 'blueprint.edn'), 'utf8');
const classKeys = [...blueprint.matchAll(/:itonami\.blueprint\/(isic-rev[0-9]+|isco-[0-9]+|unspsc)\s+"([^"]+)"/g)];
if (classKeys.length !== 1) fail(`blueprint.edn must declare exactly 1 classification key (found ${classKeys.length})`);
if (!blueprint.includes(':itonami.blueprint/license "Apache-2.0"')) fail('blueprint.edn must declare Apache-2.0 SPDX');
const notice = await readFile(resolve(app, 'NOTICE'), 'utf8');
if (!notice.includes('Apache License, Version 2.0')) fail('NOTICE missing Apache-2.0 text');

// 7. Canonical runtime pin & descriptor validation.
const pins = JSON.parse(await readFile(resolve(repo, 'otehon/shell/vendor/PINS.json'), 'utf8'));
for (const name of ['kotoba-client-runtime.js', 'kotoba-client-consent.css']) {
  const bytes = await readFile(resolve(repo, 'otehon/shell/vendor', name));
  if (sha(bytes) !== pins.files[name]) fail(`canonical runtime pin mismatch: ${name}`);
}
const {runtimeDescriptor, REQUESTED_CAPABILITIES} = await import('../src/operations.js');
const {clientRuntimeProblems} = await import('../../../otehon/shell/vendor/kotoba-client-runtime.js');
const descriptor = JSON.parse(await readFile(resolve(app, 'app-descriptor.json'), 'utf8'));
if (JSON.stringify(descriptor) !== JSON.stringify(runtimeDescriptor('ja'))) {
  fail('app-descriptor.json differs from runtimeDescriptor("ja")');
}
const probs = clientRuntimeProblems(descriptor, [...REQUESTED_CAPABILITIES], [
  'https://soudan.itonami.app', 'http://tauri.localhost', 'https://tauri.localhost',
]);
if (probs.length) fail('app-descriptor.json validation failed: ' + JSON.stringify(probs));

// 8. Android hardening & system-bar invariants.
const manifest = await readFile(resolve(app, 'src-tauri/gen/android/app/src/main/AndroidManifest.xml'), 'utf8');
if (!manifest.includes('android:allowBackup="false"')) fail('AndroidManifest.xml missing android:allowBackup="false"');
const gradle = await readFile(resolve(app, 'src-tauri/gen/android/app/build.gradle.kts'), 'utf8');
if (!/minSdk\s*=\s*33/.test(gradle)) fail('build.gradle.kts must set minSdk = 33');
const buildRs = await readFile(resolve(app, 'src-tauri/build.rs'), 'utf8');
if (!buildRs.includes('max-page-size=16384')) fail('src-tauri/build.rs missing 16KB page-size alignment');

if (failures.length) {
  console.error('Soudan public hygiene check FAILED:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('Soudan public hygiene check OK (Attorney Act, Route B honest disclosure, 7-barriers, sandbox allow-scripts, runtime pin, Android hardening)');
