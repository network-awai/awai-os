#!/usr/bin/env node
// Public safety & static freeze verification gate for Bengoshi (network.itonami.bengoshi).
// Run automatically by `npm test` and standalone via `node scripts/check-public.mjs`.

import { readFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYNTHETIC_CATALOG_BUNDLE, verifySyntheticCatalogIntegrity } from '../src/fixtures.js';
import { validateLawyerRecord } from '../src/model.js';
import { PREVIEW_BANNER_JA } from '../src/legal-notices.js';
import { OPERATOR_DISCLOSURE_STATUS } from '../src/operator-disclosure.js';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const distDir = resolve(appRoot, 'dist');
const MAX_FILE_BYTES = 10 * 1024 * 1024; // strictly < 10 MiB
const EXPECTED_WEB_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

const errors = [];
const fail = msg => errors.push(msg);

// 1. Verify app-descriptor.json & dist descriptors have operations: []
for (const rel of ['app-descriptor.json', 'dist/app-descriptor.json', 'dist/descriptor.json']) {
  try {
    const desc = JSON.parse(await readFile(resolve(appRoot, rel), 'utf8'));
    if (!Array.isArray(desc.operations) || desc.operations.length !== 0) {
      fail(`${rel} must have "operations": [] (found ${JSON.stringify(desc.operations)})`);
    }
  } catch (e) {
    fail(`Missing or invalid JSON in ${rel}: ${e.message}`);
  }
}

// 2. Walk dist/: verify no symlinks, no .git, every file < 10 MiB, collect file bytes
const distFiles = [];
async function walkDist(dir, rel = '') {
  const entries = await readdir(resolve(dir, rel), { withFileTypes: true });
  for (const entry of entries) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    const full = resolve(dir, relPath);
    if (entry.name === '.git' || relPath.includes('/.git')) {
      fail(`Forbidden .git entry in dist/: ${relPath}`);
      continue;
    }
    const st = await lstat(full);
    if (st.isSymbolicLink()) {
      fail(`Forbidden symlink in dist/: ${relPath}`);
      continue;
    }
    if (st.isDirectory()) {
      await walkDist(dir, relPath);
    } else if (st.isFile()) {
      if (st.size >= MAX_FILE_BYTES) {
        fail(`File in dist/ exceeds 10 MiB limit: ${relPath} (${st.size} bytes)`);
      }
      distFiles.push({ relPath, full, size: st.size });
    }
  }
}
await walkDist(distDir);
distFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));

// 3. Scan every file in dist/ for forbidden network/inference/retention/ACP/DDS strings
const GLOBAL_FORBIDDEN_IN_DIST = [
  { label: 'api.murakumo.cloud', re: /api\.murakumo\.cloud/i },
  { label: 'murakumo.cloud', re: /murakumo\.cloud/i },
  { label: 'murakumo/free', re: /murakumo\/free/i },
  { label: 'false zero-retention claim', re: /ログ不保存|完全非保持|サーバー非保持|日本国内限定|学習不使用|non-retention|not retained/i },
  { label: 'lawyer-matching branding', re: /lawyer[- ]matching|弁護士マッチング|運営者名義の法律相談/i },
  { label: 'forbidden jp-go-dds / dads-*', re: /jp-go-dds|dds\.css|\bdads-/i },
  { label: 'forbidden ACP action/UI', re: /acp\/action|Agent Client Protocol/i },
  { label: 'forbidden <form> or requestSubmit', re: /<form\b|requestSubmit\s*\(/i },
];

// Promotional copy forbidden in all user-facing dist files (excluding model.js O9 rejection regex table)
const PROMO_FORBIDDEN_IN_COPY = [
  { label: 'マッチング', re: /マッチング/u },
  { label: '紹介', re: /紹介/u },
  { label: 'おすすめ', re: /おすすめ/u },
];
const USER_FACING_DIST_FILES = new Set([
  'index.html',
  'messages.js',
  'legal-notices.js',
  'operator-disclosure.js',
  'fixtures.js',
  'app.js',
  'runtime-descriptor.js',
  'mcp-embed.js',
  'mcp-adapter.js',
]);

for (const f of distFiles) {
  const text = await readFile(f.full, 'utf8');
  for (const rule of GLOBAL_FORBIDDEN_IN_DIST) {
    if (rule.re.test(text)) {
      fail(`Forbidden ${rule.label} found in dist/${f.relPath}`);
    }
  }
  if (USER_FACING_DIST_FILES.has(f.relPath)) {
    for (const rule of PROMO_FORBIDDEN_IN_COPY) {
      if (rule.re.test(text)) {
        fail(`Forbidden promotional copy (${rule.label}) found in dist/${f.relPath}`);
      }
    }
  }
}

// 4. Verify public docs / manifests also have zero forbidden branding or false zero-retention claims
for (const rel of ['README.md', 'blueprint.edn', 'agent-plugin/plugin.json', 'agent-plugin/skills/bengoshi/SKILL.md', 'package.json']) {
  const text = await readFile(resolve(appRoot, rel), 'utf8');
  for (const rule of [
    { label: 'murakumo.cloud', re: /murakumo\.cloud|murakumo\/free/i },
    { label: 'false zero-retention claim', re: /ログ不保存|完全非保持|サーバー非保持|日本国内限定|学習不使用|non-retention|not retained/i },
    { label: 'forbidden branding', re: /lawyer[- ]matching|弁護士マッチング|運営者名義の法律相談/i },
    { label: 'inference.assist', re: /inference\.assist/i },
  ]) {
    if (rule.re.test(text)) {
      fail(`Forbidden ${rule.label} found in ${rel}`);
    }
  }
}

// 5. Verify exact Web <meta CSP>, <meta name="referrer" content="no-referrer">, and preview banner in dist/index.html
const distHtml = await readFile(resolve(distDir, 'index.html'), 'utf8');
if (!distHtml.includes(`content="${EXPECTED_WEB_CSP}"`)) {
  fail(`dist/index.html missing exact Web CSP: ${EXPECTED_WEB_CSP}`);
}
if (!distHtml.includes('<meta name="referrer" content="no-referrer">')) {
  fail('dist/index.html missing <meta name="referrer" content="no-referrer">');
}
if (!distHtml.includes(PREVIEW_BANNER_JA)) {
  fail('dist/index.html missing prominent preview banner');
}
if (!distHtml.includes('Bengoshi — 弁護士検索ガイド・中立ディレクトリ（準備中）')) {
  fail('dist/index.html missing required product title');
}

// 6. Verify 100% of fixtures are synthetic: true with .invalid domains & pass O9 validator
const integrity = verifySyntheticCatalogIntegrity(SYNTHETIC_CATALOG_BUNDLE);
if (!integrity.ok || !integrity.allSynthetic || !integrity.allInvalidDomains) {
  fail('Synthetic catalog integrity/synthetic/invalid-domain check failed');
}
for (const lawyer of SYNTHETIC_CATALOG_BUNDLE.lawyers) {
  if (lawyer.synthetic !== true) fail(`Fixture ${lawyer.id} must have synthetic: true`);
  const probs = validateLawyerRecord(lawyer);
  if (probs.length) fail(`Fixture ${lawyer.id} failed O9/O4 validation: ${JSON.stringify(probs)}`);
}

// 7. Verify operator-disclosure slot status
if (OPERATOR_DISCLOSURE_STATUS !== 'PENDING_OWNER_CONFIRMATION_LEGAL_224') {
  fail(`Unexpected operator disclosure status: ${OPERATOR_DISCLOSURE_STATUS}`);
}

// 8. Verify AndroidManifest has NO android.permission.INTERNET and keeps allowBackup="false"
const manifest = await readFile(resolve(appRoot, 'src-tauri/gen/android/app/src/main/AndroidManifest.xml'), 'utf8');
if (manifest.includes('android.permission.INTERNET')) {
  fail('AndroidManifest.xml must NOT request android.permission.INTERNET');
}
if (!manifest.includes('android:allowBackup="false"')) {
  fail('AndroidManifest.xml must keep android:allowBackup="false"');
}

// 9. Verify dist/release.json matches every file in dist/
const release = JSON.parse(await readFile(resolve(distDir, 'release.json'), 'utf8'));
if (release.schema !== 'awai.app.artifact.v1') fail(`release.json schema must be awai.app.artifact.v1`);
if (typeof release.source_commit !== 'string' || !release.source_commit.length) fail('release.json missing source_commit');
if (typeof release.dirty !== 'boolean') fail('release.json missing boolean dirty');
if (typeof release.versionName !== 'string' || !release.versionName.length) fail('release.json missing versionName');
if (!Number.isSafeInteger(release.versionCode)) fail('release.json missing integer versionCode');

const actualMap = {};
for (const f of distFiles) {
  if (f.relPath === 'release.json') continue;
  actualMap[f.relPath] = sha256(await readFile(f.full));
}
if (JSON.stringify(Object.keys(actualMap).sort()) !== JSON.stringify(Object.keys(release.files || {}).sort())) {
  fail('dist/release.json file list drifted from dist/ contents');
}
for (const [name, hash] of Object.entries(actualMap)) {
  if (release.files?.[name] !== hash) {
    fail(`dist/release.json SHA-256 mismatch for ${name}`);
  }
}

if (errors.length) {
  console.error('check-public FAILED:');
  for (const err of errors) console.error('  - ' + err);
  process.exit(1);
}

const maxFile = distFiles.reduce((acc, f) => (f.size > acc.size ? f : acc), { relPath: '', size: 0 });
console.log(`check-public OK: ${distFiles.length} files in dist/ verified (max: ${maxFile.relPath} = ${maxFile.size} bytes < 10 MiB, operations: [], 100% synthetic fixtures, exact Web CSP + no-referrer, no INTERNET permission).`);
