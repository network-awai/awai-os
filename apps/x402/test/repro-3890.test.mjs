// AWAI-3890 reproduction tests for the four same-type defects found in apps/isekai
// (AWAI-3216, awai-os#217): (a) stored-data overwrite, (b) silently-failed limits,
// (c) hidden startup errors, (d) system bar colour. Each test asserts the behaviour
// the isekai fix established; a failure means the defect is reproduced in x402.
// The (a)/(c) app-level cases run the real src/app.js in Node with a minimal DOM
// stub and the real packages/awai-shell host over fake localStorage/locks.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseUsd, buildRequirement, decodeState, emptyState, addDraft, MAX_DRAFTS} from '../src/model.js';
import {MESSAGES} from '../src/messages.js';
import {createHost, API} from '../../../packages/awai-shell/host.js';

const payTo = '0xA00366234D29d4F882088048c0B2fa0dB7302D4E';
const appDir = new URL('../', import.meta.url).pathname;
const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8');

// ---- (a) stored-data overwrite -------------------------------------------------

test('(a) host refuses to overwrite corrupt stored bytes (fail closed)', async () => {
  const m = new Map([[API + ':network.itonami.x402', 'broken']]);
  const h = createHost({appId: 'network.itonami.x402',
    storage: {getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v)},
    locks: {request: async (_, f) => f()}});
  await assert.rejects(h.read(), {code: 'unreadable-state'});
  await assert.rejects(h.write({expectedRevision: 0, data: emptyState()}), {code: 'unreadable-state'});
  assert.equal(m.get(API + ':network.itonami.x402'), 'broken', 'stored bytes untouched');
});

test('(a) unreadable drafts are never truncated or replaced by defaults', () => {
  const {requirement: q} = buildRequirement({amount: '2', payTo, resource: '/a'});
  let full = emptyState();
  for (let i = 0; i < MAX_DRAFTS; i++) full = addDraft(full, q, {id: 'd' + i, now: '2026-11-23T00:00:00Z'});
  assert.throws(() => decodeState({...full, drafts: [...full.drafts, {...full.drafts[0], id: 'extra'}]}), /unreadable-drafts/);
  assert.throws(() => decodeState({...full, drafts: [full.drafts[0], full.drafts[0]]}), /unreadable-drafts/);
  assert.throws(() => decodeState({schema: 'other', drafts: []}), /unreadable-drafts/);
});

// ---- (b) silently-failed limits ------------------------------------------------

test('(b) every limit violation returns a specific error code', () => {
  assert.equal(parseUsd('1000.000001').error, 'amount.max');
  assert.equal(parseUsd('1001').error, 'amount.max');
  assert.equal(parseUsd('1.2345678').error, 'amount.format');
  assert.equal(parseUsd('0').error, 'amount.zero');
  assert.equal(parseUsd('').error, 'amount.empty');
  assert.equal(buildRequirement({amount: '1', payTo, resource: '/a', description: 'x'.repeat(201)}).problems.join(), 'description.long');
  assert.equal(buildRequirement({amount: '1', payTo: 'bad', resource: '/a'}).problems.join(), 'payTo.format');
  const {requirement: q} = buildRequirement({amount: '1', payTo, resource: '/a'});
  let full = emptyState();
  for (let i = 0; i < MAX_DRAFTS; i++) full = addDraft(full, q, {id: 'd' + i, now: '2026-11-23T00:00:00Z'});
  assert.equal(full.drafts.length, MAX_DRAFTS);
  assert.throws(() => addDraft(full, q, {id: 'one-more', now: 'x'}), /too-many-drafts/);
});

// ---- (c) hidden startup errors -------------------------------------------------

test('(c) every startup notice key has a label in ja and en', () => {
  for (const key of ['host.failed', 'state.failed', 'state.unreadable', 'state.readOnly'])
    for (const loc of ['ja', 'en']) assert.ok(MESSAGES[loc][key], `${loc} ${key}`);
});

// ---- app-level harness: run the real src/app.js -------------------------------

function makeElement(tag, created) {
  const el = {tag, children: [], attrs: {}, listeners: {},
    classList: {add() {}, remove() {}},
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); },
    append(...kids) { this.children.push(...kids); this.lastChild = kids.at(-1) ?? null; },
    replaceChildren(...kids) { this.children = [...kids]; this.lastChild = kids.at(-1) ?? null; },
    querySelector() { return null; }, focus() {}};
  created.push(el);
  return el;
}

async function bootApp(seed) {
  const dir = mkdtempSync(join(tmpdir(), 'x402-repro-'));
  try {
    for (const f of ['app.js', 'model.js', 'messages.js']) cpSync(join(appDir, 'src', f), join(dir, f));
    mkdirSync(join(dir, 'awai-ui'));
    writeFileSync(join(dir, 'awai-ui', 'index.js'), 'export function bind_native() {}\n');
    writeFileSync(join(dir, 'runtime.js'),
      'export function clientRuntimeProblems() { return []; }\nexport function createClientConsentHost() { return {}; }\nexport function createClientOperationBroker() { return {}; }\n');
    writeFileSync(join(dir, 'host.js'),
      `export {createHost} from ${JSON.stringify(pathToFileURL(new URL('../../../packages/awai-shell/host.js', import.meta.url).pathname).href)};\n`);

    const created = [], byId = {};
    const documentStub = {documentElement: makeElement('html', created), title: '',
      getElementById: id => (byId[id] ??= makeElement('div', created)),
      createElement: tag => makeElement(tag, created)};
    const store = new Map(seed ? [[API + ':network.itonami.x402', seed]] : []);
    Object.defineProperty(globalThis, 'navigator',
      {value: {languages: ['ja'], locks: {request: async (_, f) => f()}}, configurable: true});
    globalThis.document = documentStub;
    globalThis.window = globalThis;
    globalThis.addEventListener = () => {};
    globalThis.location = {hash: '', origin: 'http://localhost'};
    globalThis.localStorage = {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v)};

    await import(pathToFileURL(join(dir, 'app.js')).href + '?case=' + Math.random());
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if ((byId.status?.textContent ?? '') !== '' || created.some(e => e.tag === 'h2')) break;
      await new Promise(r => setTimeout(r, 10));
    }
    await new Promise(r => setTimeout(r, 50));
    return {status: byId.status?.textContent ?? '',
      saveDisabled: created.find(e => e.tag === 'button')?.disabled};
  } finally { rmSync(dir, {recursive: true, force: true}); }
}

test('(a/c) undecodable stored drafts go read-only with the error on screen', async () => {
  const envelope = JSON.stringify({schema: API, revision: 1,
    data: {schema: 'itonami.x402.drafts.v1', drafts: [{id: 'x', createdAt: 't', requirement: {network: 'base'}}]}});
  const {status, saveDisabled} = await bootApp(envelope);
  assert.ok(status.length > 0, 'startup error is visible, not a blank page');
  assert.equal(saveDisabled, true, 'save/delete stay off over unreadable drafts');
});

test('(a) corrupt storage envelope also goes read-only instead of overwriting', async () => {
  const {status, saveDisabled} = await bootApp('broken');
  assert.ok(status.length > 0, 'startup error is visible');
  assert.equal(saveDisabled, true, 'save/delete stay off when stored state cannot be read');
});

// ---- (d) system bar colour -----------------------------------------------------

test('(d) system bars follow the theme with legible icons, also on live switch', () => {
  const kt = read('../src-tauri/gen/android/app/src/main/java/network/itonami/x402/MainActivity.kt');
  const css = read('../src/style.css');
  const manifest = read('../src-tauri/gen/android/app/src/main/AndroidManifest.xml');
  assert.match(kt, /UI_MODE_NIGHT_YES/);
  assert.match(kt, /setBackgroundColor\(if \(light\) 0xFFFFFFFF/);
  assert.match(kt, /0xFF14110F/);
  assert.match(kt, /isAppearanceLightStatusBars=light/);
  assert.match(kt, /isAppearanceLightNavigationBars=light/);
  assert.match(kt, /onConfigurationChanged/);
  assert.match(kt, /isNavigationBarContrastEnforced=false/);
  assert.match(css, /--bg:#fff/);
  assert.match(css, /prefers-color-scheme:dark\)\{:root\{--bg:#14110f/);
  assert.match(manifest, /configChanges="[^"]*uiMode/);
  assert.doesNotMatch(manifest, /locale/);
});
