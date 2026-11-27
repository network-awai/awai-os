import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeDescriptor, REQUESTED_CAPABILITIES } from '../src/runtime-descriptor.js';
import { verifySyntheticCatalogIntegrity } from '../src/fixtures.js';
import { OPERATOR_DISCLOSURE_STATUS } from '../src/operator-disclosure.js';
import { clientRuntimeProblems, clientRuntimeConnectSrc } from '../../../otehon/shell/vendor/kotoba-client-runtime.js';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = resolve(appRoot, '../..');
const sha = b => createHash('sha256').update(b).digest('hex');

const EXACT_WEB_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const EXACT_TAURI_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src ipc: http://ipc.localhost; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

test('canonical kotoba-client-runtime.js and consent css match otehon/shell/vendor/PINS.json digests', () => {
  const pins = JSON.parse(readFileSync(resolve(repoRoot, 'otehon/shell/vendor/PINS.json'), 'utf8'));
  for (const name of ['kotoba-client-runtime.js', 'kotoba-client-consent.css']) {
    const bytes = readFileSync(resolve(repoRoot, 'otehon/shell/vendor', name));
    assert.equal(sha(bytes), pins.files[name], `${name} pin digest must match PINS.json`);
  }
});

test('app-descriptor.json has operations: [] and matches exact Web/Tauri CSPs + no-referrer', () => {
  const fileDesc = JSON.parse(readFileSync(resolve(appRoot, 'app-descriptor.json'), 'utf8'));
  const codeDesc = runtimeDescriptor();
  assert.deepEqual(fileDesc, codeDesc);
  assert.deepEqual(fileDesc.operations, []);
  assert.deepEqual(clientRuntimeProblems(fileDesc, [...REQUESTED_CAPABILITIES], 'https://bengoshi.itonami.app'), []);
  assert.equal(clientRuntimeConnectSrc(fileDesc, [...REQUESTED_CAPABILITIES], [], 'https://bengoshi.itonami.app'), "connect-src 'none'");

  const html = readFileSync(resolve(appRoot, 'src/index.html'), 'utf8');
  const tauriConf = JSON.parse(readFileSync(resolve(appRoot, 'src-tauri/tauri.conf.json'), 'utf8'));
  assert.ok(!/unsafe-eval/i.test(html));
  assert.ok(html.includes(`content="${EXACT_WEB_CSP}"`), 'index.html must contain exact Web CSP');
  assert.ok(html.includes('<meta name="referrer" content="no-referrer">'), 'index.html must contain no-referrer meta');
  assert.equal(tauriConf.app.security.csp, EXACT_TAURI_CSP, 'tauri.conf.json must use Tauri IPC-only CSP');
});

test('zero jp-go-dds / dads-*, zero <form> / requestSubmit, bindForm + data-submit present, and zero ACP in src/', () => {
  for (const name of readdirSync(resolve(appRoot, 'src'))) {
    const content = readFileSync(resolve(appRoot, 'src', name), 'utf8');
    assert.ok(!/jp-go-dds|dds\.css|\bdads-/i.test(content), `Forbidden DDS reference in src/${name}`);
    assert.ok(!/<form\b|requestSubmit\s*\(/i.test(content), `Forbidden <form> or requestSubmit() in src/${name}`);
    assert.ok(!/acp\/action|Agent Client Protocol/i.test(content), `Forbidden ACP reference in src/${name}`);
  }
  const appJs = readFileSync(resolve(appRoot, 'src/app.js'), 'utf8');
  assert.match(appJs, /export function bindForm\(/);
  assert.match(appJs, /dataset\.submit/);
});

test('synthetic fixture catalog integrity digest passes and operator disclosure slot is pending Legal #224', () => {
  assert.equal(verifySyntheticCatalogIntegrity().ok, true);
  assert.equal(OPERATOR_DISCLOSURE_STATUS, 'PENDING_OWNER_CONFIRMATION_LEGAL_224');
});

test('AwaiSpec files (blueprint.edn, NOTICE, icons), AndroidManifest (no INTERNET, allowBackup=false), and cloud.itonami.profile.v2 profiles', () => {
  assert.ok(existsSync(resolve(appRoot, 'NOTICE')));
  assert.ok(existsSync(resolve(appRoot, 'icon.svg')));
  assert.ok(existsSync(resolve(appRoot, 'icon-android-foreground.svg')));

  const plugin = JSON.parse(readFileSync(resolve(appRoot, 'agent-plugin/plugin.json'), 'utf8'));
  assert.equal(plugin.specVersion, '1.0.0');
  assert.equal(plugin.status, 'poc-draft');
  assert.equal(plugin.formalAwai4143Claim, false);
  assert.equal(plugin.id, 'network.itonami.bengoshi');
  assert.equal(plugin.invariants.zeroFeeModel, 'none');
  assert.equal(plugin.invariants.feeJpy, 0);
  assert.ok(!('acp' in plugin), 'plugin.json must not expose ACP');

  const mcp = JSON.parse(readFileSync(resolve(appRoot, 'agent-plugin/mcp.json'), 'utf8'));
  assert.equal(mcp.status, 'poc-draft');
  assert.equal(mcp.mcpApps[0].status, 'poc-draft');
  assert.equal(mcp.mcpApps[0].readOnly, true);

  const bp = readFileSync(resolve(appRoot, 'blueprint.edn'), 'utf8');
  assert.match(bp, /network\.itonami\.bengoshi/);
  assert.match(bp, /:app\/kind :itonami-dapp/);
  assert.match(bp, /:app\/license "Apache-2\.0"/);
  assert.ok(!/:acp\b/.test(bp), 'blueprint.edn must not declare ACP');

  const canonicalDecisions = new Set([':autonomous', ':voice-required', ':approval-required', ':blocked']);
  for (const profile of ['bengoshi-directory', 'bengoshi-lawyer-intake']) {
    const itonamiPath = resolve(appRoot, 'profiles', profile, 'itonami.edn');
    const yakuwariPath = resolve(appRoot, 'profiles', profile, 'yakuwari.edn');
    assert.ok(existsSync(itonamiPath), `${profile}/itonami.edn must exist`);
    assert.ok(existsSync(yakuwariPath), `${profile}/yakuwari.edn must exist`);

    const edn = readFileSync(itonamiPath, 'utf8');
    const yaku = readFileSync(yakuwariPath, 'utf8');
    assert.match(edn, /:itonami\/schema "cloud\.itonami\.profile\.v2"/);
    assert.match(edn, /:default-decision :blocked/);
    assert.match(edn, /:rails \[:mishima\]/);
    assert.match(edn, /:authorities \["api\.murakumo\.cloud"\]/);
    assert.match(edn, /:deny-hosts \["openrouter\.ai"\]/);
    assert.match(edn, /:ref "yakuwari\.edn"/);
    assert.match(yaku, /:yakuwari\/capabilities/);

    for (const srcText of [edn, yaku]) {
      assert.ok(!/:ask\b|:propose\b|:each-operation-consent\b/.test(srcText), `${profile} must not use non-canonical decisions`);
      const matches = [...srcText.matchAll(/:decision\s+(:[a-z-]+)/g)];
      assert.ok(matches.length > 0);
      for (const m of matches) {
        assert.ok(canonicalDecisions.has(m[1]), `${profile} has non-canonical decision ${m[1]}`);
      }
    }
  }

  const manifest = readFileSync(resolve(appRoot, 'src-tauri/gen/android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.ok(!manifest.includes('android.permission.INTERNET'), 'AndroidManifest must NOT declare INTERNET permission');
  assert.ok(manifest.includes('android:allowBackup="false"'), 'AndroidManifest must keep allowBackup="false"');

  const buildRs = readFileSync(resolve(appRoot, 'src-tauri/build.rs'), 'utf8');
  assert.match(buildRs, /max-page-size=16384/);

  const mainKt = readFileSync(resolve(appRoot, 'src-tauri/gen/android/app/src/main/java/network/itonami/bengoshi/MainActivity.kt'), 'utf8');
  assert.match(mainKt, /SystemBars\.applyForUiMode\(this, resources\.configuration\)/);
  assert.match(mainKt, /SystemBars\.applyForUiMode\(this, newConfig\)/);

  const styleCss = readFileSync(resolve(appRoot, 'src/style.css'), 'utf8');
  assert.ok(styleCss.includes('--bg:#fff') && styleCss.includes('--bg:#14110f'));
});
