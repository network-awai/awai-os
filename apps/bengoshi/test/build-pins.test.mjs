import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeDescriptor, REQUESTED_CAPABILITIES } from '../src/runtime-descriptor.js';
import { verifySyntheticCatalogIntegrity } from '../src/fixtures.js';
import { clientRuntimeProblems, clientRuntimeConnectSrc } from '../../../otehon/shell/vendor/kotoba-client-runtime.js';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = resolve(appRoot, '../..');
const sha = b => createHash('sha256').update(b).digest('hex');

test('canonical kotoba-client-runtime.js and consent css match otehon/shell/vendor/PINS.json digests', () => {
  const pins = JSON.parse(readFileSync(resolve(repoRoot, 'otehon/shell/vendor/PINS.json'), 'utf8'));
  for (const name of ['kotoba-client-runtime.js', 'kotoba-client-consent.css']) {
    const bytes = readFileSync(resolve(repoRoot, 'otehon/shell/vendor', name));
    assert.equal(sha(bytes), pins.files[name], `${name} pin digest must match PINS.json`);
  }
});

test('app-descriptor.json matches src/runtime-descriptor.js and CSP connect-src without unsafe-eval', () => {
  const fileDesc = JSON.parse(readFileSync(resolve(appRoot, 'app-descriptor.json'), 'utf8'));
  const codeDesc = runtimeDescriptor('ja');
  assert.deepEqual(fileDesc, codeDesc);
  assert.deepEqual(clientRuntimeProblems(fileDesc, [...REQUESTED_CAPABILITIES], 'http://tauri.localhost'), []);

  const connect = 'connect-src ipc: http://ipc.localhost ' +
    clientRuntimeConnectSrc(fileDesc, [...REQUESTED_CAPABILITIES], [], 'http://tauri.localhost').slice('connect-src '.length) + ';';

  const html = readFileSync(resolve(appRoot, 'src/index.html'), 'utf8');
  const tauriConf = JSON.parse(readFileSync(resolve(appRoot, 'src-tauri/tauri.conf.json'), 'utf8'));
  assert.ok(!/unsafe-eval/i.test(html), 'index.html CSP must not contain unsafe-eval');
  assert.ok(!/unsafe-eval/i.test(tauriConf.app.security.csp), 'tauri.conf.json CSP must not contain unsafe-eval');
  assert.ok(html.includes(connect), 'index.html CSP connect-src must match descriptor');
  assert.ok(tauriConf.app.security.csp.includes(connect), 'tauri.conf.json CSP connect-src must match descriptor');
});

test('zero jp-go-dds / dds.css / dads-* references exist anywhere in apps/bengoshi/src/', () => {
  for (const name of readdirSync(resolve(appRoot, 'src'))) {
    const content = readFileSync(resolve(appRoot, 'src', name), 'utf8');
    assert.ok(!/jp-go-dds|dds\.css|\bdads-/i.test(content), `Forbidden DDS reference in src/${name}`);
  }
});

test('synthetic fixture catalog integrity digest passes', () => {
  assert.equal(verifySyntheticCatalogIntegrity().ok, true);
});

test('agent-plugin v1.0.0 manifests, blueprint.edn, bot profiles, and Android 16 KB config exist and enforce invariants', () => {
  const plugin = JSON.parse(readFileSync(resolve(appRoot, 'agent-plugin/plugin.json'), 'utf8'));
  assert.equal(plugin.specVersion, '1.0.0');
  assert.equal(plugin.id, 'network.itonami.bengoshi');
  assert.equal(plugin.invariants.zeroFeeModel, 'none');

  const mcp = JSON.parse(readFileSync(resolve(appRoot, 'agent-plugin/mcp.json'), 'utf8'));
  assert.ok(mcp.mcpServers.bengoshi);
  assert.equal(mcp.mcpApps[0].protocol, 'SEP-1865');
  assert.equal(mcp.mcpApps[0].readOnly, true);

  const skill = readFileSync(resolve(appRoot, 'agent-plugin/skills/bengoshi/SKILL.md'), 'utf8');
  assert.match(skill, /O2 = none/);
  assert.match(skill, /AWAI-3235/);

  const bp = readFileSync(resolve(appRoot, 'blueprint.edn'), 'utf8');
  assert.match(bp, /network\.itonami\.bengoshi/);
  assert.match(bp, /:o2-zero-fee/);

  for (const profile of ['bengoshi-directory', 'bengoshi-lawyer-intake']) {
    const edn = readFileSync(resolve(appRoot, 'profiles', profile, 'itonami.edn'), 'utf8');
    assert.match(edn, /murakumo\.cloud/);
    assert.match(edn, /:model :none/);
  }

  const buildRs = readFileSync(resolve(appRoot, 'src-tauri/build.rs'), 'utf8');
  assert.match(buildRs, /max-page-size=16384/);

  const mainKt = readFileSync(resolve(appRoot, 'src-tauri/gen/android/app/src/main/java/network/itonami/bengoshi/MainActivity.kt'), 'utf8');
  assert.match(mainKt, /SystemBars\.applyForUiMode\(this, resources\.configuration\)/);
  assert.match(mainKt, /SystemBars\.applyForUiMode\(this, newConfig\)/);

  const styleCss = readFileSync(resolve(appRoot, 'src/style.css'), 'utf8');
  assert.ok(styleCss.includes('--bg:#fff') && styleCss.includes('--bg:#14110f'));
});
