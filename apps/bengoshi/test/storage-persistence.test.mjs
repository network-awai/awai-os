import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHost } from '../../../packages/awai-shell/host.js';
import { persistLocalState, classifyStorageError, STORAGE_KEY } from '../src/storage.js';
import { createInitialLocalState, createOperationsEngine } from '../src/operations.js';
import { verifyAuditChain } from '../src/model.js';
import { SYNTHETIC_CATALOG_BUNDLE } from '../src/fixtures.js';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const NOW = '2026-11-27T09:00:00Z';

function makeQuotaError() {
  return Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
}

function makeSecurityError() {
  return Object.assign(new Error('Access to storage is denied.'), { name: 'SecurityError' });
}

function createMemoryStorage() {
  const map = new Map();
  let nextSetError = null;
  return {
    map,
    failWritesWith(err) { nextSetError = err; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) {
      if (nextSetError) throw nextSetError;
      map.set(k, String(v));
    },
    removeItem(k) { map.delete(k); },
  };
}

// Serializing Web Locks mock matching real navigator.locks exclusive lock semantics per lock name.
function createQueuingLocks() {
  const queues = new Map();
  return {
    request(name, fn) {
      const prev = queues.get(name) || Promise.resolve();
      const next = prev.then(() => fn());
      queues.set(name, next.catch(() => {}));
      return next;
    },
  };
}

test('persistLocalState returns { ok: false, error, code, message } on storage QuotaExceededError and recovers on retry', async () => {
  const storage = createMemoryStorage();
  const locks = createQueuingLocks();
  const host = createHost({ appId: 'network.itonami.bengoshi', storage, locks });
  const state = createInitialLocalState();
  state.lawyerProfile = structuredClone(SYNTHETIC_CATALOG_BUNDLE.lawyers[0]);

  storage.failWritesWith(makeQuotaError());
  const failed = await persistLocalState({ host, revision: 0, state });

  assert.equal(failed.ok, false);
  assert.equal(failed.via, 'host');
  assert.equal(failed.code, 'storage-unavailable');
  assert.equal(failed.error?.code, 'storage-unavailable');
  assert.equal(storage.getItem(STORAGE_KEY), null);

  // Recover and retry
  storage.failWritesWith(null);
  const ok = await persistLocalState({ host, revision: 0, state });
  assert.equal(ok.ok, true);
  assert.equal(ok.revision, 1);
  assert.equal(ok.via, 'host');
  assert.ok(storage.getItem(STORAGE_KEY));
});

test('persistLocalState classifies direct QuotaExceededError, SecurityError, data-too-large, unreadable-state, atomic-write-unavailable, and state-conflict', async () => {
  const state = createInitialLocalState();

  assert.equal(classifyStorageError(makeQuotaError()).code, 'quota-exceeded');
  assert.equal(classifyStorageError(makeSecurityError()).code, 'storage-unavailable');
  assert.equal(classifyStorageError(Object.assign(new Error('atomic-write-unavailable'), { code: 'atomic-write-unavailable' })).code, 'atomic-write-unavailable');
  assert.equal(classifyStorageError(Object.assign(new Error('unreadable-state'), { code: 'unreadable-state' })).code, 'unreadable-state');
  assert.equal(classifyStorageError(Object.assign(new Error('state-conflict'), { code: 'state-conflict' })).code, 'state-conflict');

  const failingHost = {
    async write() { throw Object.assign(new Error('disk full'), { code: 'data-too-large' }); },
  };
  const failCustom = await persistLocalState({ host: failingHost, revision: 1, state });
  assert.equal(failCustom.ok, false);
  assert.equal(failCustom.code, 'quota-exceeded');

  // Host declaring atomicWrite: false must fail closed before calling host.write
  let writeCalled = false;
  const nonAtomicHost = {
    info: () => ({ capabilities: { atomicWrite: false } }),
    async write() { writeCalled = true; return { revision: 2 }; },
  };
  const failNonAtomic = await persistLocalState({ host: nonAtomicHost, revision: 1, state });
  assert.equal(failNonAtomic.ok, false);
  assert.equal(failNonAtomic.code, 'atomic-write-unavailable');
  assert.equal(writeCalled, false);
});

test('dual-writer regression (Path 1 — Web Locks / host): sequential and concurrent writers never overwrite; stale writer fails with state-conflict and succeeds after reconciling', async () => {
  const storage = createMemoryStorage();
  const locks = createQueuingLocks();
  const hostA = createHost({ appId: 'network.itonami.bengoshi', storage, locks });
  const hostB = createHost({ appId: 'network.itonami.bengoshi', storage, locks });

  // Both writers read initial revision 0
  const readA0 = await hostA.read();
  const readB0 = await hostB.read();
  assert.equal(readA0.revision, 0);
  assert.equal(readB0.revision, 0);

  // Writer A saves draft 1 -> revision 1
  const stateA = createInitialLocalState();
  stateA.draft = { clientName: '依頼者A', summary: '先の下書き（A）' };
  const resA1 = await persistLocalState({ host: hostA, revision: readA0.revision, state: stateA });
  assert.equal(resA1.ok, true);
  assert.equal(resA1.revision, 1);
  assert.equal(resA1.via, 'host');

  // Writer B tries to save draft 2 using stale revision 0 -> MUST fail with state-conflict
  const stateBStale = createInitialLocalState();
  stateBStale.lawyerProfile = structuredClone(SYNTHETIC_CATALOG_BUNDLE.lawyers[0]);
  const resBStale = await persistLocalState({ host: hostB, revision: readB0.revision, state: stateBStale });
  assert.equal(resBStale.ok, false);
  assert.equal(resBStale.code, 'state-conflict');
  assert.equal(resBStale.via, 'host');

  // Writer A's draft MUST NOT be lost
  const afterConflict = await hostB.read();
  assert.equal(afterConflict.revision, 1);
  assert.equal(afterConflict.data.draft.summary, '先の下書き（A）');
  assert.equal(afterConflict.data.lawyerProfile, null);

  // Writer B reconciles on top of revision 1 and retries -> revision 2 keeping BOTH changes
  const mergedB = structuredClone(afterConflict.data);
  mergedB.lawyerProfile = structuredClone(SYNTHETIC_CATALOG_BUNDLE.lawyers[0]);
  const resBRetry = await persistLocalState({ host: hostB, revision: afterConflict.revision, state: mergedB });
  assert.equal(resBRetry.ok, true);
  assert.equal(resBRetry.revision, 2);

  const afterMerge = await hostA.read();
  assert.equal(afterMerge.revision, 2);
  assert.equal(afterMerge.data.draft.summary, '先の下書き（A）');
  assert.equal(afterMerge.data.lawyerProfile.id, SYNTHETIC_CATALOG_BUNDLE.lawyers[0].id);

  // Concurrent dual-writer at revision 2 (Promise.all): exactly one wins (rev 3) and one fails closed with state-conflict
  const concA = structuredClone(afterMerge.data);
  concA.settings.directoryScope = 'neutral_cross_firm';
  const concB = structuredClone(afterMerge.data);
  concB.settings.syntheticDemoMode = true;

  const [rA, rB] = await Promise.all([
    persistLocalState({ host: hostA, revision: 2, state: concA }),
    persistLocalState({ host: hostB, revision: 2, state: concB }),
  ]);
  const winners = [rA, rB].filter(r => r.ok);
  const losers = [rA, rB].filter(r => !r.ok);
  assert.equal(winners.length, 1);
  assert.equal(winners[0].revision, 3);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].code, 'state-conflict');

  const finalStored = await hostA.read();
  assert.equal(finalStored.revision, 3);
  assert.equal(finalStored.data.draft.summary, '先の下書き（A）');
  assert.equal(finalStored.data.settings.directoryScope, 'neutral_cross_firm');
});

test('dual-writer regression (Path 2 — missing Web Locks): refuses writes fail-closed with atomic-write-unavailable and never overwrites existing drafts', async () => {
  const storage = createMemoryStorage();
  const existingState = createInitialLocalState();
  existingState.draft = { clientName: '既存相談者', summary: '絶対に消してはいけない先の下書き' };
  storage.setItem(STORAGE_KEY, JSON.stringify({
    schema: 'awai.shell.host.v1',
    revision: 1,
    data: existingState,
  }));

  // Two hosts created without Web Locks (locks: null and locks: {})
  const host1 = createHost({ appId: 'network.itonami.bengoshi', storage, locks: null });
  const host2 = createHost({ appId: 'network.itonami.bengoshi', storage, locks: {} });

  const r1 = await host1.read();
  const r2 = await host2.read();
  assert.equal(r1.revision, 1);
  assert.equal(r2.revision, 1);

  const draft1 = structuredClone(r1.data);
  draft1.draft = { clientName: '書き手1', summary: '下書き1' };
  const draft2 = structuredClone(r2.data);
  draft2.draft = { clientName: '書き手2', summary: '下書き2' };

  const res1 = await persistLocalState({ host: host1, revision: r1.revision, state: draft1 });
  const res2 = await persistLocalState({ host: host2, revision: r2.revision, state: draft2 });

  // Both MUST fail closed (never return ok: true with same revision, never silently overwrite)
  assert.equal(res1.ok, false);
  assert.equal(res1.code, 'atomic-write-unavailable');
  assert.equal(res2.ok, false);
  assert.equal(res2.code, 'atomic-write-unavailable');

  // Pre-existing revision 1 draft MUST remain completely untouched
  const persisted = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(persisted.revision, 1);
  assert.equal(persisted.data.draft.summary, '絶対に消してはいけない先の下書き');

  // Also verify from empty storage (revision 0): both refuse writes and leave storage empty
  const emptyStorage = createMemoryStorage();
  const emptyHost1 = createHost({ appId: 'network.itonami.bengoshi', storage: emptyStorage, locks: null });
  const emptyHost2 = createHost({ appId: 'network.itonami.bengoshi', storage: emptyStorage, locks: null });
  const e1 = await persistLocalState({ host: emptyHost1, revision: 0, state: draft1 });
  const e2 = await persistLocalState({ host: emptyHost2, revision: 0, state: draft2 });
  assert.equal(e1.ok, false);
  assert.equal(e1.code, 'atomic-write-unavailable');
  assert.equal(e2.ok, false);
  assert.equal(e2.code, 'atomic-write-unavailable');
  assert.equal(emptyStorage.getItem(STORAGE_KEY), null);
});

test('operations engine rolls back committed state cleanly when onStateChange returns { ok: false } and succeeds on retry', async () => {
  const state = createInitialLocalState();
  let shouldFail = true;
  const engine = createOperationsEngine({
    state,
    now: () => NOW,
    onStateChange: async () => (
      shouldFail
        ? { ok: false, error: makeQuotaError(), code: 'quota-exceeded', message: 'The quota has been exceeded.' }
        : { ok: true, revision: 1 }
    ),
  });

  const candidate = structuredClone(SYNTHETIC_CATALOG_BUNDLE.lawyers[0]);
  await assert.rejects(
    () => engine.execute('lawyer.profile.update', { profile: candidate, action: 'onboarding_preview' }),
    err => err.code === 'storage-persist-failed' && err.persistResult?.code === 'quota-exceeded',
  );

  // Committed state must be cleanly rolled back
  assert.equal(state.lawyerProfile, null);
  assert.equal(state.lawyerEditHistory.length, 0);
  assert.equal(state.auditLog.length, 0);

  // Retry after storage recovers
  shouldFail = false;
  const out = await engine.execute('lawyer.profile.update', { profile: candidate, action: 'onboarding_preview' });
  assert.equal(out.savedLocally, true);
  assert.equal(state.lawyerProfile.id, candidate.id);
  assert.equal(state.lawyerEditHistory.length, 1);
  assert.equal(state.auditLog.length, 1);
});

// ---- Lightweight deterministic DOM harness to test real built dist/app.js end-to-end ----
function createMiniDom(initialHash = '#/guide') {
  class MiniElement {
    constructor(tagName) {
      this.tagName = String(tagName).toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.attributes = new Map();
      this.listeners = new Map();
      this.dataset = {};
      this.style = {};
      this.className = '';
      this.id = '';
      this.type = '';
      this.value = '';
      this.placeholder = '';
      this.checked = false;
      this.selected = false;
      this.disabled = false;
      this.hidden = false;
      this.readOnly = false;
      this.href = '';
      this.target = '';
      this.rel = '';
      this.htmlFor = '';
      this._textContent = '';
    }
    get textContent() {
      if (this.children.length === 0) return this._textContent;
      return this._textContent + this.children.map(c => c.textContent).join('');
    }
    set textContent(val) {
      this._textContent = val === undefined || val === null ? '' : String(val);
      this.children = [];
    }
    setAttribute(k, v) {
      const str = String(v);
      this.attributes.set(k, str);
      if (k === 'id') this.id = str;
      if (k === 'class') this.className = str;
    }
    getAttribute(k) {
      if (k === 'id') return this.id || null;
      if (k === 'class') return this.className || null;
      return this.attributes.has(k) ? this.attributes.get(k) : null;
    }
    append(...nodes) {
      for (const n of nodes) {
        if (!n) continue;
        if (typeof n === 'string') {
          this._textContent += n;
        } else {
          n.parentNode = this;
          this.children.push(n);
        }
      }
    }
    prepend(...nodes) {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (!n) continue;
        n.parentNode = this;
        this.children.unshift(n);
      }
    }
    replaceChildren(...nodes) {
      this.children = [];
      this._textContent = '';
      this.append(...nodes);
    }
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter(c => c !== this);
      this.parentNode = null;
    }
    select() {}
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    async dispatch(type, ev = {}) {
      const list = this.listeners.get(type) || [];
      const event = { target: this, preventDefault() {}, ...ev };
      for (const fn of list) {
        await fn(event);
      }
    }
    walk(fn) {
      fn(this);
      for (const c of this.children) c.walk(fn);
    }
    querySelectorAll(selector) {
      const matches = [];
      this.walk(node => {
        if (matchesSelector(node, selector)) matches.push(node);
      });
      return matches;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
  }

  function matchesSelector(node, selector) {
    if (selector === 'button[type="button"][data-submit]') {
      return node.tagName === 'BUTTON' && node.type === 'button' && Object.prototype.hasOwnProperty.call(node.dataset, 'submit');
    }
    if (selector === '[role="alert"]') {
      return node.getAttribute('role') === 'alert';
    }
    if (selector === '[data-storage-alert="true"]') {
      return node.dataset.storageAlert === 'true';
    }
    if (selector === 'input[type="checkbox"]') {
      return node.tagName === 'INPUT' && node.type === 'checkbox';
    }
    if (selector === 'button') {
      return node.tagName === 'BUTTON';
    }
    if (selector.startsWith('#')) {
      return node.id === selector.slice(1);
    }
    return node.tagName === selector.toUpperCase();
  }

  const root = new MiniElement('main');
  const ids = [
    'title', 'subtitle', 'environment', 'badge-zero-fee', 'lang-toggle',
    'preview-banner', 'mode-bar', 'nav', 'settings-panel', 'status',
    'storage-alert', 'view', 'footer',
  ];
  const byId = new Map();
  for (const id of ids) {
    const tag = id === 'lang-toggle' ? 'button' : id === 'settings-panel' ? 'details' : 'div';
    const node = new MiniElement(tag);
    node.id = id;
    if (id === 'storage-alert') {
      node.setAttribute('role', 'alert');
      node.hidden = true;
    }
    byId.set(id, node);
    root.append(node);
  }

  const windowListeners = new Map();
  let currentHash = initialHash;
  const locationObj = {
    origin: 'https://bengoshi.itonami.app',
    pathname: '/',
    search: '',
    get hash() { return currentHash; },
    set hash(v) {
      currentHash = String(v);
      const handlers = windowListeners.get('hashchange') || [];
      for (const fn of handlers) fn();
    },
  };

  const documentObj = {
    documentElement: { lang: 'ja' },
    title: '',
    body: root,
    createElement: tag => new MiniElement(tag),
    getElementById: id => {
      if (byId.has(id)) return byId.get(id);
      let found = null;
      root.walk(n => { if (!found && n.id === id) found = n; });
      return found;
    },
    execCommand: () => true,
  };

  const windowObj = {
    parent: null,
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
  };
  windowObj.parent = windowObj;

  return {
    root,
    document: documentObj,
    window: windowObj,
    location: locationObj,
    history: { replaceState(_s, _t, url) { const idx = url.indexOf('#'); if (idx >= 0) currentHash = url.slice(idx); } },
  };
}

let bootSeq = 0;
async function mountBuiltApp({ initialHash = '#/guide', storage = createMemoryStorage(), locks = createQueuingLocks() } = {}) {
  const dom = createMiniDom(initialHash);
  const prev = {
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    location: Object.getOwnPropertyDescriptor(globalThis, 'location'),
    history: Object.getOwnPropertyDescriptor(globalThis, 'history'),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    autostart: globalThis.__BENGOSHI_DISABLE_AUTOSTART__,
  };

  const setGlobal = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  setGlobal('document', dom.document);
  setGlobal('window', dom.window);
  setGlobal('location', dom.location);
  setGlobal('history', dom.history);
  setGlobal('localStorage', storage);
  setGlobal('navigator', { languages: ['ja-JP'], locks, clipboard: { writeText: async () => {} } });
  globalThis.__BENGOSHI_DISABLE_AUTOSTART__ = true;

  const distAppUrl = pathToFileURL(resolve(appRoot, 'dist/app.js')).href + `?run=${++bootSeq}`;
  const mod = await import(distAppUrl);
  await mod.start();

  const restore = () => {
    for (const [k, desc] of Object.entries(prev)) {
      if (k === 'autostart') continue;
      if (desc) Object.defineProperty(globalThis, k, desc);
      else delete globalThis[k];
    }
    if (prev.autostart === undefined) delete globalThis.__BENGOSHI_DISABLE_AUTOSTART__;
    else globalThis.__BENGOSHI_DISABLE_AUTOSTART__ = prev.autostart;
  };

  return { dom, mod, storage, locks, restore };
}

async function flushMicrotasks() {
  for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 5));
}

// Helper simulating a second tab committing a state transition through its own host + operations engine
async function runOtherTabOperation({ storage, locks, op, params }) {
  const otherHost = createHost({ appId: 'network.itonami.bengoshi', storage, locks });
  const stored = await otherHost.read();
  let otherRev = stored.revision;
  const otherState = stored.data
    ? { ...createInitialLocalState(), ...structuredClone(stored.data), settings: { ...createInitialLocalState().settings, ...(stored.data.settings || {}) } }
    : createInitialLocalState();
  const otherEngine = createOperationsEngine({
    state: otherState,
    now: () => NOW,
    onStateChange: async (s) => {
      const res = await persistLocalState({ host: otherHost, revision: otherRev, state: s });
      if (res.ok) otherRev = res.revision;
      return res;
    },
  });
  await otherEngine.execute(op, params, { actor: 'ui' });
  return otherRev;
}

test('UI regression (#/lawyer/onboarding): QuotaExceededError blocks navigation, preserves input, shows role="alert" error (not success), and succeeds on retry', async () => {
  const storage = createMemoryStorage();
  const { dom, restore } = await mountBuiltApp({ initialHash: '#/lawyer/onboarding', storage });
  try {
    const view = dom.document.getElementById('view');
    const nameIn = dom.document.getElementById('ob-name');
    const kanaIn = dom.document.getElementById('ob-kana');
    const barIn = dom.document.getElementById('ob-bar');
    const regIn = dom.document.getElementById('ob-reg');
    const officeIn = dom.document.getElementById('ob-office');
    const phoneIn = dom.document.getElementById('ob-phone');

    nameIn.value = '山田 検証（架空サンプル）';
    kanaIn.value = 'やまだ けんしょう';
    barIn.value = '東京弁護士会';
    regIn.value = '991234';
    officeIn.value = '検証テスト法律事務所';
    phoneIn.value = '03-0000-1234';

    storage.failWritesWith(makeQuotaError());
    const submitBtn = view.querySelector('button[type="button"][data-submit]');
    await submitBtn.dispatch('click');
    await flushMicrotasks();

    assert.equal(dom.location.hash, '#/lawyer/onboarding');
    assert.equal(dom.document.getElementById('ob-name').value, '山田 検証（架空サンプル）');
    assert.equal(dom.document.getElementById('ob-kana').value, 'やまだ けんしょう');
    assert.equal(dom.document.getElementById('ob-bar').value, '東京弁護士会');
    assert.equal(dom.document.getElementById('ob-reg').value, '991234');
    assert.equal(dom.document.getElementById('ob-office').value, '検証テスト法律事務所');
    assert.equal(dom.document.getElementById('ob-phone').value, '03-0000-1234');

    const alerts = view.querySelectorAll('[role="alert"]').filter(n => !n.hidden);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].textContent, /端末ストレージへの保存に失敗しました/);
    assert.match(alerts[0].textContent, /容量/);
    assert.equal(dom.document.getElementById('status').textContent, '');
    assert.equal(storage.getItem(STORAGE_KEY), null);

    storage.failWritesWith(null);
    await submitBtn.dispatch('click');
    await flushMicrotasks();

    assert.equal(dom.location.hash, '#/lawyer/profile');
    assert.match(dom.document.getElementById('status').textContent, /端末内に保存しました/);
    const persisted = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.equal(persisted.data.lawyerProfile.name, '山田 検証（架空サンプル）');
    assert.equal(persisted.data.lawyerProfile.registration_number, '991234');
  } finally {
    restore();
  }
});

test('UI regression (#/lawyer/onboarding): missing Web Locks (locks: null) refuses write fail-closed, preserves inputs, shows Web Locks alert, and leaves storage untouched', async () => {
  const storage = createMemoryStorage();
  const { dom, restore } = await mountBuiltApp({
    initialHash: '#/lawyer/onboarding',
    storage,
    locks: null,
  });
  try {
    const view = dom.document.getElementById('view');
    dom.document.getElementById('ob-name').value = '高橋 排他確認（架空サンプル）';
    dom.document.getElementById('ob-bar').value = '東京弁護士会';
    dom.document.getElementById('ob-reg').value = '997777';
    dom.document.getElementById('ob-office').value = '排他確認法律事務所';
    dom.document.getElementById('ob-phone').value = '03-0000-7777';

    const submitBtn = view.querySelector('button[type="button"][data-submit]');
    await submitBtn.dispatch('click');
    await flushMicrotasks();

    assert.equal(dom.location.hash, '#/lawyer/onboarding');
    assert.equal(dom.document.getElementById('ob-name').value, '高橋 排他確認（架空サンプル）');
    assert.equal(dom.document.getElementById('ob-reg').value, '997777');
    const visibleAlerts = view.querySelectorAll('[role="alert"]').filter(n => !n.hidden);
    assert.equal(visibleAlerts.length, 1);
    assert.match(visibleAlerts[0].textContent, /Web Locks|排他制御/);
    assert.equal(dom.document.getElementById('status').textContent, '');
    assert.equal(storage.getItem(STORAGE_KEY), null);
  } finally {
    restore();
  }
});

test('UI regression (#/lawyer/onboarding): host storage write rejection keeps route & inputs intact and succeeds on retry', async () => {
  const storage = createMemoryStorage();
  const { dom, restore } = await mountBuiltApp({
    initialHash: '#/lawyer/onboarding',
    storage,
  });
  try {
    const view = dom.document.getElementById('view');
    dom.document.getElementById('ob-name').value = '鈴木 試験（架空サンプル）';
    dom.document.getElementById('ob-bar').value = '大阪弁護士会';
    dom.document.getElementById('ob-reg').value = '995678';
    dom.document.getElementById('ob-office').value = '大阪試験法律事務所';
    dom.document.getElementById('ob-phone').value = '06-0000-5678';

    storage.failWritesWith(makeSecurityError());
    const submitBtn = view.querySelector('button[type="button"][data-submit]');
    await submitBtn.dispatch('click');
    await flushMicrotasks();

    assert.equal(dom.location.hash, '#/lawyer/onboarding');
    assert.equal(dom.document.getElementById('ob-name').value, '鈴木 試験（架空サンプル）');
    assert.equal(dom.document.getElementById('ob-reg').value, '995678');
    const visibleAlerts = view.querySelectorAll('[role="alert"]').filter(n => !n.hidden);
    assert.equal(visibleAlerts.length, 1);
    assert.match(visibleAlerts[0].textContent, /端末ストレージへの保存に失敗しました/);
    assert.equal(dom.document.getElementById('status').textContent, '');

    storage.failWritesWith(null);
    await submitBtn.dispatch('click');
    await flushMicrotasks();

    assert.equal(dom.location.hash, '#/lawyer/profile');
    assert.match(dom.document.getElementById('status').textContent, /端末内に保存しました/);
    const persisted = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.equal(persisted.revision, 1);
    assert.equal(persisted.data.lawyerProfile.registration_number, '995678');
  } finally {
    restore();
  }
});

test('UI regression (#/lawyer/profile): QuotaExceededError preserves edited fields, rolls back committed state, shows alert, and saves on retry', async () => {
  const storage = createMemoryStorage();
  const seedState = createInitialLocalState();
  seedState.lawyerProfile = structuredClone(SYNTHETIC_CATALOG_BUNDLE.lawyers[0]);
  storage.setItem(STORAGE_KEY, JSON.stringify({ schema: 'awai.shell.host.v1', revision: 1, data: seedState }));

  const { dom, restore } = await mountBuiltApp({ initialHash: '#/lawyer/profile', storage });
  try {
    const view = dom.document.getElementById('view');
    const officeIn = dom.document.getElementById('pe-office');
    const feeIn = dom.document.getElementById('pe-fee');
    officeIn.value = '更新後のサンプル法律事務所';
    feeIn.value = '初回30分5,500円（税込）';
    await officeIn.dispatch('input');
    await feeIn.dispatch('input');

    storage.failWritesWith(makeQuotaError());
    const saveBtn = view.querySelector('button[type="button"][data-submit]');
    await saveBtn.dispatch('click');
    await flushMicrotasks();

    assert.equal(dom.location.hash, '#/lawyer/profile');
    assert.equal(officeIn.value, '更新後のサンプル法律事務所');
    assert.equal(feeIn.value, '初回30分5,500円（税込）');
    const visibleAlerts = view.querySelectorAll('[role="alert"]').filter(n => !n.hidden);
    assert.equal(visibleAlerts.length, 1);
    assert.match(visibleAlerts[0].textContent, /端末ストレージへの保存に失敗しました/);
    assert.equal(dom.document.getElementById('status').textContent, '');
    assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).data.lawyerProfile.office_name, seedState.lawyerProfile.office_name);

    storage.failWritesWith(null);
    await saveBtn.dispatch('click');
    await flushMicrotasks();

    assert.equal(view.querySelectorAll('[role="alert"]').filter(n => !n.hidden).length, 0);
    assert.match(dom.document.getElementById('status').textContent, /保存しました/);
    assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).data.lawyerProfile.office_name, '更新後のサンプル法律事務所');
    assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).data.lawyerProfile.initial_consultation_fee_note, '初回30分5,500円（税込）');
  } finally {
    restore();
  }
});

test('UI regression (#/contact/compose): QuotaExceededError blocks transition to consent, preserves draft inputs, and succeeds on retry', async () => {
  const storage = createMemoryStorage();
  const { dom, restore } = await mountBuiltApp({ initialHash: '#/contact/compose', storage });
  try {
    const view = dom.document.getElementById('view');
    const nameIn = dom.document.getElementById('c-name');
    const contactIn = dom.document.getElementById('c-contact');
    const counterIn = dom.document.getElementById('c-counter');
    const sumArea = dom.document.getElementById('c-summary');

    nameIn.value = '相談者テスト';
    await nameIn.dispatch('input');
    contactIn.value = 'client@example.invalid';
    await contactIn.dispatch('input');
    counterIn.value = '相手方テスト株式会社';
    await counterIn.dispatch('input');
    sumArea.value = '未払い残業代の相談メモです。';
    await sumArea.dispatch('input');

    storage.failWritesWith(makeQuotaError());
    const submitButtons = view.querySelectorAll('button[type="button"][data-submit]');
    const nextBtn = submitButtons[submitButtons.length - 1];
    await nextBtn.dispatch('click');
    await flushMicrotasks();

    assert.equal(dom.location.hash, '#/contact/compose');
    assert.equal(nameIn.value, '相談者テスト');
    assert.equal(sumArea.value, '未払い残業代の相談メモです。');
    const visibleAlerts = view.querySelectorAll('[role="alert"]').filter(n => !n.hidden);
    assert.equal(visibleAlerts.length, 1);
    assert.match(visibleAlerts[0].textContent, /端末ストレージへの保存に失敗しました/);
    assert.equal(storage.getItem(STORAGE_KEY), null);

    storage.failWritesWith(null);
    await nextBtn.dispatch('click');
    await flushMicrotasks();

    assert.equal(dom.location.hash, '#/contact/consent');
    const persisted = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.equal(persisted.data.draft.clientName, '相談者テスト');
    assert.equal(persisted.data.draft.summary, '未払い残業代の相談メモです。');
  } finally {
    restore();
  }
});

test('UI regression (#/lawyer/inquiry/detail): conflict-check confirmation reverts checkbox and stays locked on storage failure, then unlocks on retry', async () => {
  const storage = createMemoryStorage();
  const { dom, restore } = await mountBuiltApp({ initialHash: '#/lawyer/inbox', storage });
  try {
    const view = dom.document.getElementById('view');
    const seedBtn = view.querySelectorAll('button').find(b => b.textContent.includes('架空QA暗号化問い合わせ'));
    assert.ok(seedBtn, 'Seed QA button must exist');
    await seedBtn.dispatch('click');
    await flushMicrotasks();

    dom.location.hash = '#/lawyer/inquiry/inq-qa-clear-001';
    await flushMicrotasks();

    const runBtn = view.querySelectorAll('button').find(b => b.textContent.includes('利益相反チェックを実行'));
    assert.ok(runBtn, 'Run conflict check button must exist');
    await runBtn.dispatch('click');
    await flushMicrotasks();

    const confirmBox = view.querySelector('input[type="checkbox"]');
    assert.ok(confirmBox, 'Conflict confirmation checkbox must exist');
    storage.failWritesWith(makeQuotaError());
    confirmBox.checked = true;
    await confirmBox.dispatch('change');
    await flushMicrotasks();

    assert.equal(confirmBox.checked, false);
    const revealBtn = view.querySelectorAll('button').find(b => b.textContent.includes('復号・閲覧'));
    assert.equal(revealBtn.disabled, true);
    const visibleAlerts = view.querySelectorAll('[role="alert"]').filter(n => !n.hidden);
    assert.equal(visibleAlerts.length, 1);
    assert.match(visibleAlerts[0].textContent, /端末ストレージへの保存に失敗しました/);

    storage.failWritesWith(null);
    confirmBox.checked = true;
    await confirmBox.dispatch('change');
    await flushMicrotasks();

    const unlockedRevealBtn = view.querySelectorAll('button').find(b => b.textContent.includes('復号・閲覧'));
    assert.equal(unlockedRevealBtn.disabled, false);
  } finally {
    restore();
  }
});

// ---- Finding 1 [P1]: Cross-tab state-conflict retry WITHOUT overwriting other tab's changes ----

test('Cross-tab state-conflict regression (#/lawyer/onboarding): preserves form inputs on v1->v2 conflict, does not overwrite Tab B draft, and retry succeeds as v3 keeping BOTH changes', async () => {
  const storage = createMemoryStorage();
  const locks = createQueuingLocks();
  const v1State = createInitialLocalState();
  storage.setItem(STORAGE_KEY, JSON.stringify({ schema: 'awai.shell.host.v1', revision: 1, data: v1State }));

  // Tab A loads v1 on onboarding screen and fills inputs
  const { dom, restore } = await mountBuiltApp({ initialHash: '#/lawyer/onboarding', storage, locks });
  try {
    const view = dom.document.getElementById('view');
    dom.document.getElementById('ob-name').value = '佐藤 競合試験（架空サンプル）';
    dom.document.getElementById('ob-kana').value = 'さとう きょうごうしけん';
    dom.document.getElementById('ob-bar').value = '東京弁護士会';
    dom.document.getElementById('ob-reg').value = '994321';
    dom.document.getElementById('ob-office').value = '競合確認法律事務所';
    dom.document.getElementById('ob-phone').value = '03-0000-4321';

    // Tab B writes a consultation draft -> creates v2 in storage
    const v2Rev = await runOtherTabOperation({
      storage,
      locks,
      op: 'inquiry.draft',
      params: {
        draft: {
          lawyerId: SYNTHETIC_CATALOG_BUNDLE.lawyers[0].id,
          category: 'work',
          clientName: '別タブ相談者',
          clientContact: 'tab-b@example.invalid',
          counterpartyName: '別タブ相手方株式会社',
          summary: '別タブで保存した大切な下書き',
          wish: '未払い賃金請求',
          deadline: '2026-12-31',
          documents: ['給与明細'],
          evidenceManifest: [],
        },
      },
    });
    assert.equal(v2Rev, 2);

    // Tab A attempts save -> hits state-conflict
    const submitBtn = view.querySelector('button[type="button"][data-submit]');
    await submitBtn.dispatch('click');
    await flushMicrotasks();

    // Must stay on onboarding with ALL user inputs preserved
    assert.equal(dom.location.hash, '#/lawyer/onboarding');
    assert.equal(dom.document.getElementById('ob-name').value, '佐藤 競合試験（架空サンプル）');
    assert.equal(dom.document.getElementById('ob-kana').value, 'さとう きょうごうしけん');
    assert.equal(dom.document.getElementById('ob-bar').value, '東京弁護士会');
    assert.equal(dom.document.getElementById('ob-reg').value, '994321');
    assert.equal(dom.document.getElementById('ob-office').value, '競合確認法律事務所');
    assert.equal(dom.document.getElementById('ob-phone').value, '03-0000-4321');

    // Must show role="alert" conflict notice explaining version refresh (1 -> 2)
    const alerts = view.querySelectorAll('[role="alert"]').filter(n => !n.hidden);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].textContent, /別タブ/);
    assert.match(alerts[0].textContent, /1\s*→\s*2/);
    assert.equal(dom.document.getElementById('status').textContent, '');

    // Must NOT overwrite Tab B's v2 data in storage
    const afterConflict = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.equal(afterConflict.revision, 2);
    assert.equal(afterConflict.data.draft.summary, '別タブで保存した大切な下書き');
    assert.equal(afterConflict.data.lawyerProfile, null);

    // Tab A clicks retry immediately -> MUST succeed as v3 keeping BOTH Tab B's v2 draft AND Tab A's profile!
    await submitBtn.dispatch('click');
    await flushMicrotasks();

    assert.equal(dom.location.hash, '#/lawyer/profile');
    assert.match(dom.document.getElementById('status').textContent, /端末内に保存しました/);

    const v3 = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.equal(v3.revision, 3);
    assert.equal(v3.data.draft.clientName, '別タブ相談者');
    assert.equal(v3.data.draft.summary, '別タブで保存した大切な下書き');
    assert.equal(v3.data.lawyerProfile.name, '佐藤 競合試験（架空サンプル）');
    assert.equal(v3.data.lawyerProfile.registration_number, '994321');
    assert.equal(v3.data.auditLog.length, 2);
    assert.equal(verifyAuditChain(v3.data.auditLog).ok, true);
  } finally {
    restore();
  }
});

test('Cross-tab state-conflict regression (#/lawyer/profile): rebases field edits on v2, syncs untouched fields, preserves Tab B updates, and succeeds as v3', async () => {
  const storage = createMemoryStorage();
  const locks = createQueuingLocks();
  const seed = createInitialLocalState();
  seed.lawyerProfile = structuredClone(SYNTHETIC_CATALOG_BUNDLE.lawyers[0]);
  seed.lawyerProfile.office_name = '初期サンプル法律事務所';
  seed.lawyerProfile.initial_consultation_fee_note = '初回30分無料';
  storage.setItem(STORAGE_KEY, JSON.stringify({ schema: 'awai.shell.host.v1', revision: 1, data: seed }));

  // Tab A loads v1 on profile edit screen and edits ONLY feeIn
  const { dom, restore } = await mountBuiltApp({ initialHash: '#/lawyer/profile', storage, locks });
  try {
    const view = dom.document.getElementById('view');
    const officeIn = dom.document.getElementById('pe-office');
    const feeIn = dom.document.getElementById('pe-fee');
    assert.equal(officeIn.value, '初期サンプル法律事務所');

    feeIn.value = '初回30分5,500円（税込）';
    await feeIn.dispatch('input');

    // Tab B updates office_name in lawyerProfile (same entity, different field!) -> v2
    const updatedByTabB = structuredClone(seed.lawyerProfile);
    updatedByTabB.office_name = '別タブ更新法律事務所';
    const v2Rev = await runOtherTabOperation({
      storage,
      locks,
      op: 'lawyer.profile.update',
      params: { profile: updatedByTabB, action: 'profile_update' },
    });
    assert.equal(v2Rev, 2);

    // Tab A clicks save -> hits state-conflict
    const saveBtn = view.querySelector('button[type="button"][data-submit]');
    await saveBtn.dispatch('click');
    await flushMicrotasks();

    // Tab A's edited feeIn is preserved; untouched officeIn synced to Tab B's v2 value
    assert.equal(feeIn.value, '初回30分5,500円（税込）');
    assert.equal(officeIn.value, '別タブ更新法律事務所');
    const alerts = view.querySelectorAll('[role="alert"]').filter(n => !n.hidden);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].textContent, /別タブ/);
    assert.match(alerts[0].textContent, /同じ項目/);

    // Storage is still v2 untouched
    const v2Stored = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.equal(v2Stored.revision, 2);
    assert.equal(v2Stored.data.lawyerProfile.office_name, '別タブ更新法律事務所');
    assert.equal(v2Stored.data.lawyerProfile.initial_consultation_fee_note, '初回30分無料');

    // Tab A retries save -> succeeds as v3 keeping BOTH Tab B's office_name AND Tab A's fee note
    await saveBtn.dispatch('click');
    await flushMicrotasks();

    assert.equal(view.querySelectorAll('[role="alert"]').filter(n => !n.hidden).length, 0);
    assert.match(dom.document.getElementById('status').textContent, /保存しました/);

    const v3 = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.equal(v3.revision, 3);
    assert.equal(v3.data.lawyerProfile.office_name, '別タブ更新法律事務所');
    assert.equal(v3.data.lawyerProfile.initial_consultation_fee_note, '初回30分5,500円（税込）');
    assert.equal(v3.data.lawyerEditHistory.length, 2);
    assert.equal(verifyAuditChain(v3.data.auditLog).ok, true);
  } finally {
    restore();
  }
});

test('Cross-tab state-conflict regression (#/contact/compose): preserves draft inputs on conflict, keeps Tab B profile update, and retry succeeds as v3', async () => {
  const storage = createMemoryStorage();
  const locks = createQueuingLocks();
  const v1State = createInitialLocalState();
  storage.setItem(STORAGE_KEY, JSON.stringify({ schema: 'awai.shell.host.v1', revision: 1, data: v1State }));

  // Tab A loads v1 on contact compose and fills a draft
  const { dom, restore } = await mountBuiltApp({ initialHash: '#/contact/compose', storage, locks });
  try {
    const view = dom.document.getElementById('view');
    const nameIn = dom.document.getElementById('c-name');
    const contactIn = dom.document.getElementById('c-contact');
    const counterIn = dom.document.getElementById('c-counter');
    const sumArea = dom.document.getElementById('c-summary');

    nameIn.value = '相談者A（タブA）';
    await nameIn.dispatch('input');
    contactIn.value = 'tab-a@example.invalid';
    await contactIn.dispatch('input');
    counterIn.value = '相手方A株式会社';
    await counterIn.dispatch('input');
    sumArea.value = 'タブAで作成した相談メモです。';
    await sumArea.dispatch('input');

    // Tab B updates lawyerProfile -> creates v2
    const profileB = structuredClone(SYNTHETIC_CATALOG_BUNDLE.lawyers[0]);
    profileB.office_name = 'タブB登録法律事務所';
    const v2Rev = await runOtherTabOperation({
      storage,
      locks,
      op: 'lawyer.profile.update',
      params: { profile: profileB },
    });
    assert.equal(v2Rev, 2);

    // Tab A clicks proceed -> hits state-conflict
    const submitButtons = view.querySelectorAll('button[type="button"][data-submit]');
    const nextBtn = submitButtons[submitButtons.length - 1];
    await nextBtn.dispatch('click');
    await flushMicrotasks();

    assert.equal(dom.location.hash, '#/contact/compose');
    assert.equal(nameIn.value, '相談者A（タブA）');
    assert.equal(sumArea.value, 'タブAで作成した相談メモです。');
    const alerts = view.querySelectorAll('[role="alert"]').filter(n => !n.hidden);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].textContent, /別タブ/);

    // Retry -> succeeds as v3, navigates to consent, preserves BOTH Tab B profile AND Tab A draft
    await nextBtn.dispatch('click');
    await flushMicrotasks();

    assert.equal(dom.location.hash, '#/contact/consent');
    const v3 = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.equal(v3.revision, 3);
    assert.equal(v3.data.lawyerProfile.office_name, 'タブB登録法律事務所');
    assert.equal(v3.data.draft.clientName, '相談者A（タブA）');
    assert.equal(v3.data.draft.summary, 'タブAで作成した相談メモです。');
    assert.equal(verifyAuditChain(v3.data.auditLog).ok, true);
  } finally {
    restore();
  }
});

test('Cross-tab state-conflict regression (#/lawyer/inbox ledger direct mutation): preserves input on conflict and retry succeeds as v3 keeping Tab B draft', async () => {
  const storage = createMemoryStorage();
  const locks = createQueuingLocks();
  const v1State = createInitialLocalState();
  storage.setItem(STORAGE_KEY, JSON.stringify({ schema: 'awai.shell.host.v1', revision: 1, data: v1State }));

  const { dom, restore } = await mountBuiltApp({ initialHash: '#/lawyer/inbox', storage, locks });
  try {
    const view = dom.document.getElementById('view');
    const ledgerInput = view.querySelectorAll('input').find(i => i.placeholder.includes('追加する依頼者'));
    assert.ok(ledgerInput, 'Ledger add input must exist');
    ledgerInput.value = '競合テスト株式会社';

    // Tab B saves draft -> creates v2
    await runOtherTabOperation({
      storage,
      locks,
      op: 'inquiry.draft',
      params: {
        draft: {
          lawyerId: SYNTHETIC_CATALOG_BUNDLE.lawyers[0].id,
          category: 'contract',
          clientName: '別タブ依頼者',
          clientContact: 'other@example.invalid',
          counterpartyName: '相手方会社',
          summary: '別タブの契約相談下書き',
        },
      },
    });

    const submitButtons = view.querySelectorAll('button[type="button"][data-submit]');
    const ledgerAddBtn = submitButtons[submitButtons.length - 1];
    await ledgerAddBtn.dispatch('click');
    await flushMicrotasks();

    // Input preserved and conflict alert shown; v2 not overwritten
    assert.equal(ledgerInput.value, '競合テスト株式会社');
    const alerts = view.querySelectorAll('[role="alert"]').filter(n => !n.hidden);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].textContent, /別タブ/);
    assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).revision, 2);

    // Retry succeeds as v3 preserving BOTH Tab B's draft AND Tab A's new ledger party
    await ledgerAddBtn.dispatch('click');
    await flushMicrotasks();

    const v3 = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.equal(v3.revision, 3);
    assert.equal(v3.data.draft.summary, '別タブの契約相談下書き');
    assert.ok(v3.data.conflictLedger.some(row => row.partyName === '競合テスト株式会社'));
  } finally {
    restore();
  }
});

test('Cross-tab state-conflict regression (#/contact/compose): retry after Tab B re-imports soudan.memo.export.v1 keeps Tab A summary edit AND Tab B updated timeline, evidenceManifest, and evidenceHashes', async () => {
  const storage = createMemoryStorage();
  const locks = createQueuingLocks();
  const v1Hash = '1'.repeat(64);
  const v2HashA = 'a'.repeat(64);
  const v2HashB = 'b'.repeat(64);

  const seed = createInitialLocalState();
  seed.draft = {
    lawyerId: SYNTHETIC_CATALOG_BUNDLE.lawyers[0].id,
    template: 'consultation-memo.jpn.v1',
    category: 'work',
    clientName: '初期相談者',
    clientContact: 'v1@example.invalid',
    counterpartyName: '初期相手方株式会社',
    summary: 'v1の相談概要',
    timeline: [{ date: '2026-10-01', event: 'v1の出来事' }],
    wish: 'v1の希望対応',
    deadline: '2026-12-01',
    documents: ['v1給与明細.pdf'],
    evidenceManifest: [
      {
        url: 'https://v1.example.invalid/post/1',
        posted_at: '2026-10-01T10:00:00Z',
        author_name: '投稿者v1',
        author_id: '@v1_author',
        shot_name: 'v1-shot.png',
        shot_size: 1024,
        captured_at: '2026-10-02T00:00:00Z',
        sha256: v1Hash,
      },
    ],
    evidenceHashes: [
      {
        url: 'https://v1.example.invalid/post/1',
        shotName: 'v1-shot.png',
        sha256: v1Hash,
        capturedAt: '2026-10-02T00:00:00Z',
      },
    ],
    importedFromSoudan: true,
    importedAt: '2026-10-02T00:00:00Z',
  };
  storage.setItem(STORAGE_KEY, JSON.stringify({ schema: 'awai.shell.host.v1', revision: 1, data: seed }));

  // Tab A opens the existing v1 draft and edits ONLY summary
  const { dom, restore } = await mountBuiltApp({ initialHash: '#/contact/compose', storage, locks });
  try {
    const view = dom.document.getElementById('view');
    const catSel = dom.document.getElementById('c-cat');
    const nameIn = dom.document.getElementById('c-name');
    const contactIn = dom.document.getElementById('c-contact');
    const counterIn = dom.document.getElementById('c-counter');
    const sumArea = dom.document.getElementById('c-summary');
    const wishArea = dom.document.getElementById('c-wish');
    const deadIn = dom.document.getElementById('c-deadline');
    const docsArea = dom.document.getElementById('c-docs');
    const evArea = dom.document.getElementById('c-evidence');

    assert.equal(sumArea.value, 'v1の相談概要');
    assert.equal(JSON.parse(evArea.value)[0].sha256, v1Hash);

    sumArea.value = 'タブAで編集した最新概要';
    await sumArea.dispatch('input');

    // Tab B re-imports a different soudan.memo.export.v1 into the same draft -> revision 2
    const v2Memo = {
      schema: 'soudan.memo.export.v1',
      template: 'consultation-memo.jpn.v1',
      memo: {
        category: 'contract',
        name: '再取込相談者B',
        contact: 'v2@example.invalid',
        otherParty: '再取込相手方株式会社',
        summary: 'タブBで再取り込みした概要',
        wish: 'タブBで更新した希望対応',
        deadline: '2027-01-31',
        timeline: [
          { date: '2026-11-01', event: 'v2の出来事1（契約締結）' },
          { date: '2026-11-15', event: 'v2の出来事2（催告書送付）' },
        ],
        documents: ['v2契約書.pdf', 'v2通知書.pdf'],
      },
      evidence_manifest: [
        {
          url: 'https://v2.example.invalid/post/101',
          posted_at: '2026-11-01T12:00:00Z',
          author_name: '投稿者v2A',
          author_id: '@v2_author_a',
          shot_name: 'v2-shot-a.png',
          shot_size: 2048,
          captured_at: '2026-11-16T09:00:00Z',
          sha256: v2HashA,
        },
        {
          url: 'https://v2.example.invalid/post/102',
          posted_at: '2026-11-15T15:30:00Z',
          author_name: '投稿者v2B',
          author_id: '@v2_author_b',
          shot_name: 'v2-shot-b.png',
          shot_size: 4096,
          captured_at: '2026-11-16T09:05:00Z',
          sha256: v2HashB,
        },
      ],
    };
    const v2Rev = await runOtherTabOperation({
      storage,
      locks,
      op: 'inquiry.import_memo',
      params: { json: JSON.stringify(v2Memo), lawyerId: SYNTHETIC_CATALOG_BUNDLE.lawyers[0].id },
    });
    assert.equal(v2Rev, 2);

    // Tab A clicks Save Draft -> hits state-conflict
    const saveBtn = view.querySelectorAll('button').find(b => b.textContent.includes('下書き保存'));
    assert.ok(saveBtn, 'Save draft button must exist');
    await saveBtn.dispatch('click');
    await flushMicrotasks();

    // Tab A retains its dirty summary while untouched controls & read-only evidence refresh to Tab B's v2 values
    assert.equal(sumArea.value, 'タブAで編集した最新概要');
    assert.equal(catSel.value, 'contract');
    assert.equal(nameIn.value, '再取込相談者B');
    assert.equal(contactIn.value, 'v2@example.invalid');
    assert.equal(counterIn.value, '再取込相手方株式会社');
    assert.equal(wishArea.value, 'タブBで更新した希望対応');
    assert.equal(deadIn.value, '2027-01-31');
    assert.equal(docsArea.value, 'v2契約書.pdf\nv2通知書.pdf');
    const refreshedEvPreview = JSON.parse(evArea.value);
    assert.equal(refreshedEvPreview.length, 2);
    assert.deepEqual(refreshedEvPreview.map(e => e.sha256), [v2HashA, v2HashB]);

    const alerts = view.querySelectorAll('[role="alert"]').filter(n => !n.hidden);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].textContent, /別タブ/);
    assert.match(alerts[0].textContent, /1\s*→\s*2/);
    assert.match(alerts[0].textContent, /同じ項目/);
    assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).revision, 2);

    // Tab A retries Save Draft -> succeeds as v3 keeping Tab A's summary AND Tab B's timeline, evidenceManifest, and evidenceHashes
    await saveBtn.dispatch('click');
    await flushMicrotasks();

    assert.equal(view.querySelectorAll('[role="alert"]').filter(n => !n.hidden).length, 0);
    assert.match(dom.document.getElementById('status').textContent, /保存しました/);

    const v3 = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.equal(v3.revision, 3);
    assert.equal(v3.data.draft.summary, 'タブAで編集した最新概要');
    assert.equal(v3.data.draft.category, 'contract');
    assert.equal(v3.data.draft.clientName, '再取込相談者B');
    assert.equal(v3.data.draft.clientContact, 'v2@example.invalid');
    assert.equal(v3.data.draft.counterpartyName, '再取込相手方株式会社');
    assert.equal(v3.data.draft.wish, 'タブBで更新した希望対応');
    assert.equal(v3.data.draft.deadline, '2027-01-31');
    assert.deepEqual(v3.data.draft.documents, ['v2契約書.pdf', 'v2通知書.pdf']);
    assert.deepEqual(v3.data.draft.timeline, [
      { date: '2026-11-01', event: 'v2の出来事1（契約締結）' },
      { date: '2026-11-15', event: 'v2の出来事2（催告書送付）' },
    ]);
    assert.equal(v3.data.draft.evidenceManifest.length, 2);
    assert.deepEqual(v3.data.draft.evidenceManifest.map(e => e.sha256), [v2HashA, v2HashB]);
    assert.deepEqual(v3.data.draft.evidenceManifest.map(e => e.url), [
      'https://v2.example.invalid/post/101',
      'https://v2.example.invalid/post/102',
    ]);
    assert.equal(v3.data.draft.evidenceHashes.length, 2);
    assert.deepEqual(v3.data.draft.evidenceHashes.map(e => e.sha256), [v2HashA, v2HashB]);
    for (let i = 0; i < v3.data.draft.evidenceManifest.length; i++) {
      assert.equal(v3.data.draft.evidenceHashes[i].url, v3.data.draft.evidenceManifest[i].url);
      assert.equal(v3.data.draft.evidenceHashes[i].shotName, v3.data.draft.evidenceManifest[i].shot_name);
      assert.equal(v3.data.draft.evidenceHashes[i].sha256, v3.data.draft.evidenceManifest[i].sha256);
      assert.equal(v3.data.draft.evidenceHashes[i].capturedAt, v3.data.draft.evidenceManifest[i].captured_at);
    }
    assert.equal(verifyAuditChain(v3.data.auditLog).ok, true);
  } finally {
    restore();
  }
});

test('Cross-tab state-conflict regression (#/lawyer/onboarding): rebases touched phone edit onto existing profile without clobbering Tab B office/fee/areas updates', async () => {
  const storage = createMemoryStorage();
  const locks = createQueuingLocks();
  const seed = createInitialLocalState();
  seed.lawyerProfile = structuredClone(SYNTHETIC_CATALOG_BUNDLE.lawyers[0]);
  seed.lawyerProfile.office_name = 'v1サンプル法律事務所';
  seed.lawyerProfile.phone = '03-0000-1111';
  seed.lawyerProfile.practice_areas = ['労働', '消費者問題'];
  seed.lawyerProfile.career_facts = ['2020年 弁護士登録'];
  seed.lawyerProfile.initial_consultation_fee_note = '初回30分無料';
  storage.setItem(STORAGE_KEY, JSON.stringify({ schema: 'awai.shell.host.v1', revision: 1, data: seed }));

  const { dom, restore } = await mountBuiltApp({ initialHash: '#/lawyer/onboarding', storage, locks });
  try {
    const view = dom.document.getElementById('view');
    const officeIn = dom.document.getElementById('ob-office');
    const phoneIn = dom.document.getElementById('ob-phone');
    assert.equal(officeIn.value, 'v1サンプル法律事務所');
    assert.equal(phoneIn.value, '03-0000-1111');

    // Tab A edits ONLY phone
    phoneIn.value = '03-0000-9999';
    await phoneIn.dispatch('input');

    // Tab B updates office_name & initial_consultation_fee_note on the same profile -> v2
    const updatedByTabB = structuredClone(seed.lawyerProfile);
    updatedByTabB.office_name = 'v2別タブ更新法律事務所';
    updatedByTabB.initial_consultation_fee_note = '初回60分5,500円（税込）';
    const v2Rev = await runOtherTabOperation({
      storage,
      locks,
      op: 'lawyer.profile.update',
      params: { profile: updatedByTabB, action: 'profile_update' },
    });
    assert.equal(v2Rev, 2);

    const submitBtn = view.querySelector('button[type="button"][data-submit]');
    await submitBtn.dispatch('click');
    await flushMicrotasks();

    // Conflict keeps Tab A phone edit and refreshes untouched office_name to Tab B's v2
    assert.equal(dom.location.hash, '#/lawyer/onboarding');
    assert.equal(phoneIn.value, '03-0000-9999');
    assert.equal(officeIn.value, 'v2別タブ更新法律事務所');
    const alerts = view.querySelectorAll('[role="alert"]').filter(n => !n.hidden);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].textContent, /別タブ/);

    // Retry succeeds as v3 keeping Tab A's phone AND Tab B's office_name, fee note, practice_areas, career_facts
    await submitBtn.dispatch('click');
    await flushMicrotasks();

    assert.equal(dom.location.hash, '#/lawyer/profile');
    const v3 = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.equal(v3.revision, 3);
    assert.equal(v3.data.lawyerProfile.phone, '03-0000-9999');
    assert.equal(v3.data.lawyerProfile.office_name, 'v2別タブ更新法律事務所');
    assert.equal(v3.data.lawyerProfile.initial_consultation_fee_note, '初回60分5,500円（税込）');
    assert.deepEqual(v3.data.lawyerProfile.practice_areas, ['労働', '消費者問題']);
    assert.deepEqual(v3.data.lawyerProfile.career_facts, ['2020年 弁護士登録']);
    assert.equal(verifyAuditChain(v3.data.auditLog).ok, true);
  } finally {
    restore();
  }
});

test('Overlapping saves regression (Fix 1 — operations engine): earlier failed op NEVER rolls back later succeeded op in memory (both before and after B succeeds)', async () => {
  const lawyerId = SYNTHETIC_CATALOG_BUNDLE.lawyers[0].id;
  const draftA = {
    lawyerId,
    category: 'work',
    clientName: '相談者A',
    clientContact: 'a@example.invalid',
    counterpartyName: '相手方A株式会社',
    summary: '先に開始して失敗する下書きA',
  };
  const draftB = {
    lawyerId,
    category: 'work',
    clientName: '相談者B',
    clientContact: 'b@example.invalid',
    counterpartyName: '相手方B株式会社',
    summary: '後から開始して成功する下書きB',
  };

  // Scenario 1: Op A fails AFTER Op B has already succeeded (exact Kougi out-of-order failure scenario)
  {
    const state = createInitialLocalState();
    let persisted = null;
    let settleOpA = null;
    let callCount = 0;

    const engine = createOperationsEngine({
      state,
      now: () => NOW,
      onStateChange: async (candidate) => {
        callCount += 1;
        if (callCount === 1) {
          return new Promise((resolve) => {
            settleOpA = () => resolve({
              ok: false,
              code: 'quota-exceeded',
              message: 'The quota has been exceeded.',
              error: makeQuotaError(),
            });
          });
        }
        persisted = structuredClone(candidate);
        return { ok: true, revision: 1 };
      },
    });

    const opA = engine.execute('inquiry.draft', { draft: draftA });
    const opB = engine.execute('inquiry.draft', { draft: draftB });

    // Op B completes and commits first
    const resB = await opB;
    assert.equal(resB.savedLocally, true);
    assert.equal(persisted.draft.summary, draftB.summary);
    assert.equal(state.draft.summary, draftB.summary);
    assert.equal(state.auditLog.length, 1);

    // Now earlier Op A fails AFTER Op B succeeded — MUST NOT roll back state.draft to null or auditLog to 0!
    settleOpA();
    await assert.rejects(opA, err => err.code === 'storage-persist-failed' && err.persistResult?.code === 'quota-exceeded');

    assert.equal(persisted.draft.summary, draftB.summary);
    assert.notEqual(state.draft, null, 'In-memory draft must NOT be rolled back to null');
    assert.equal(state.draft.summary, draftB.summary);
    assert.equal(state.auditLog.length, 1, 'In-memory auditLog must NOT be rolled back to 0');
    assert.equal(state.auditLog[0].operation, 'inquiry.draft');
    assert.equal(verifyAuditChain(state.auditLog).ok, true);
  }

  // Scenario 2: Op A rejects (thrown error) AFTER Op B succeeded
  {
    const state = createInitialLocalState();
    let persisted = null;
    let rejectOpA = null;
    let callCount = 0;

    const engine = createOperationsEngine({
      state,
      now: () => NOW,
      onStateChange: async (candidate) => {
        callCount += 1;
        if (callCount === 1) {
          return new Promise((_, reject) => { rejectOpA = reject; });
        }
        persisted = structuredClone(candidate);
        return { ok: true, revision: 1 };
      },
    });

    const opA = engine.execute('inquiry.draft', { draft: draftA });
    const opB = engine.execute('inquiry.draft', { draft: draftB });

    await opB;
    rejectOpA(makeQuotaError());
    await assert.rejects(opA, err => err.code === 'storage-persist-failed');

    assert.equal(persisted.draft.summary, draftB.summary);
    assert.equal(state.draft.summary, draftB.summary);
    assert.equal(state.auditLog.length, 1);
    assert.equal(verifyAuditChain(state.auditLog).ok, true);
  }

  // Scenario 3: Op A fails BEFORE Op B succeeds (serialized and non-serialized)
  for (const serializeWrites of [false, true]) {
    const state = createInitialLocalState();
    let persisted = null;
    let callCount = 0;

    const engine = createOperationsEngine({
      state,
      now: () => NOW,
      serializeWrites,
      onStateChange: async (candidate) => {
        callCount += 1;
        if (callCount === 1) {
          await new Promise(r => setTimeout(r, 10));
          return { ok: false, code: 'storage-write-failed', message: 'write-1-failed' };
        }
        await new Promise(r => setTimeout(r, 20));
        persisted = structuredClone(candidate);
        return { ok: true, revision: 1 };
      },
    });

    const opA = engine.execute('inquiry.draft', { draft: draftA });
    const opB = engine.execute('inquiry.draft', { draft: draftB });

    const [rA, rB] = await Promise.allSettled([opA, opB]);
    assert.equal(rA.status, 'rejected');
    assert.equal(rB.status, 'fulfilled');

    assert.equal(persisted.draft.summary, draftB.summary);
    assert.equal(state.draft.summary, draftB.summary);
    assert.equal(state.auditLog.length, 1);
    assert.equal(verifyAuditChain(state.auditLog).ok, true);
  }

  // Scenario 4: Stale earlier Op A resolving late with older revision NEVER overwrites newer committed Op B
  {
    const state = createInitialLocalState();
    let resolveOpA = null;
    let callCount = 0;

    const engine = createOperationsEngine({
      state,
      now: () => NOW,
      onStateChange: async () => {
        callCount += 1;
        if (callCount === 1) {
          return new Promise(resolve => { resolveOpA = () => resolve({ ok: true, revision: 1 }); });
        }
        return { ok: true, revision: 2 };
      },
    });

    const opA = engine.execute('inquiry.draft', { draft: draftA });
    const opB = engine.execute('inquiry.draft', { draft: draftB });

    await opB;
    assert.equal(state.draft.summary, draftB.summary);

    resolveOpA();
    await opA;
    assert.equal(state.draft.summary, draftB.summary, 'Older op revision must never overwrite newer committed revision');
  }
});

test('Overlapping saves regression (Fix 1 — UI #/contact/compose): earlier failed save overlapping with later succeeded save keeps storage, in-memory draft, and audit log on B', async () => {
  const storage = createMemoryStorage();
  const baseLocks = createQueuingLocks();
  let releaseFirstLock = null;
  let lockCalls = 0;

  const deferredLocks = {
    request(name, fn) {
      lockCalls += 1;
      const callNum = lockCalls;
      return baseLocks.request(name, async () => {
        if (callNum === 1) {
          await new Promise(resolve => { releaseFirstLock = resolve; });
        }
        return fn();
      });
    },
  };

  const { dom, restore } = await mountBuiltApp({
    initialHash: '#/contact/compose',
    storage,
    locks: deferredLocks,
  });

  try {
    const view = dom.document.getElementById('view');
    const nameIn = dom.document.getElementById('c-name');
    const contactIn = dom.document.getElementById('c-contact');
    const counterIn = dom.document.getElementById('c-counter');
    const sumArea = dom.document.getElementById('c-summary');
    const saveBtn = view.querySelectorAll('button').find(b => b.textContent.includes('下書き保存'));

    nameIn.value = '重複保存テスト依頼者';
    contactIn.value = 'overlap@example.invalid';
    counterIn.value = '相手方株式会社';
    sumArea.value = '下書きA（失敗予定）';
    await sumArea.dispatch('input');

    // Start Save A (write #1 will fail once lock releases)
    storage.failWritesWith(makeQuotaError());
    const clickA = saveBtn.dispatch('click');
    await flushMicrotasks();
    assert.ok(releaseFirstLock, 'First save must be awaiting its lock');

    // While Save A is still in flight, user edits to B and clicks Save B
    sumArea.value = '下書きB（成功予定）';
    await sumArea.dispatch('input');
    const clickB = saveBtn.dispatch('click');

    // Allow Save A to hit QuotaExceededError, then clear storage error so Save B succeeds
    const origSetItem = storage.setItem.bind(storage);
    let attempts = 0;
    storage.setItem = (k, v) => {
      attempts += 1;
      if (attempts === 1) {
        storage.failWritesWith(null);
        throw makeQuotaError();
      }
      return origSetItem(k, v);
    };

    releaseFirstLock();
    await Promise.all([clickA, clickB]);
    await flushMicrotasks();

    // Verify storage holds B with 1 valid audit entry
    const persisted = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.equal(persisted.revision, 1);
    assert.equal(persisted.data.draft.summary, '下書きB（成功予定）');
    assert.equal(persisted.data.auditLog.length, 1);
    assert.equal(verifyAuditChain(persisted.data.auditLog).ok, true);

    // Verify in-memory state in app (NOT rolled back to null / 0) by re-visiting #/audit and #/contact/compose
    dom.location.hash = '#/audit';
    await flushMicrotasks();
    const auditViewText = dom.document.getElementById('view').textContent;
    assert.match(auditViewText, /inquiry\.draft/);
    assert.match(auditViewText, /1\s*件|1\s*entries/);

    dom.location.hash = '#/contact/compose';
    await flushMicrotasks();
    assert.equal(dom.document.getElementById('c-summary').value, '下書きB（成功予定）');
  } finally {
    restore();
  }
});

test('In-flight typing regression (Fix 2 — #/contact/compose): edits typed while save is pending are preserved as unsaved input after save resolves and persisted on next save', async () => {
  const storage = createMemoryStorage();
  const baseLocks = createQueuingLocks();
  let releasePendingWrite = null;
  let holdNextWrite = true;

  const deferredLocks = {
    request(name, fn) {
      return baseLocks.request(name, async () => {
        if (holdNextWrite) {
          holdNextWrite = false;
          await new Promise(resolve => { releasePendingWrite = resolve; });
        }
        return fn();
      });
    },
  };

  const { dom, restore } = await mountBuiltApp({
    initialHash: '#/contact/compose',
    storage,
    locks: deferredLocks,
  });

  try {
    const view = dom.document.getElementById('view');
    const nameIn = dom.document.getElementById('c-name');
    const contactIn = dom.document.getElementById('c-contact');
    const counterIn = dom.document.getElementById('c-counter');
    const sumArea = dom.document.getElementById('c-summary');
    const saveBtn = view.querySelectorAll('button').find(b => b.textContent.includes('下書き保存'));

    nameIn.value = '保存中追記テスト相談者';
    contactIn.value = 'inflight@example.invalid';
    counterIn.value = '相手方株式会社';
    sumArea.value = '初稿';
    await nameIn.dispatch('input');
    await contactIn.dispatch('input');
    await counterIn.dispatch('input');
    await sumArea.dispatch('input');

    // Start saving "初稿" — write stays pending
    const firstSave = saveBtn.dispatch('click');
    await flushMicrotasks();
    assert.ok(releasePendingWrite, 'First save must be pending');

    // While write is pending, user appends text in DOM input
    sumArea.value = '初稿＋保存中追記';
    await sumArea.dispatch('input');

    // Resolve deferred write (having saved "初稿")
    releasePendingWrite();
    await firstSave;
    await flushMicrotasks();

    // Storage holds "初稿" (rev 1), while DOM input STILL preserves "初稿＋保存中追記"
    const v1 = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.equal(v1.revision, 1);
    assert.equal(v1.data.draft.summary, '初稿');
    assert.equal(sumArea.value, '初稿＋保存中追記', 'In-flight summary edit must NOT be wiped by applyDraftToForm');
    assert.equal(nameIn.value, '保存中追記テスト相談者');

    // Subsequent save cleanly persists "初稿＋保存中追記" as rev 2
    await saveBtn.dispatch('click');
    await flushMicrotasks();

    const v2 = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.equal(v2.revision, 2);
    assert.equal(v2.data.draft.summary, '初稿＋保存中追記');
    assert.equal(sumArea.value, '初稿＋保存中追記');
    assert.equal(verifyAuditChain(v2.data.auditLog).ok, true);
  } finally {
    restore();
  }
});

test('In-flight typing regression (Fix 2 — #/lawyer/profile and #/lawyer/onboarding): preserves in-flight edits and blocks onboarding navigation until edits are saved', async () => {
  // Part 1: #/lawyer/profile
  {
    const storage = createMemoryStorage();
    const baseLocks = createQueuingLocks();
    let releasePendingWrite = null;
    let holdNextWrite = true;

    const deferredLocks = {
      request(name, fn) {
        return baseLocks.request(name, async () => {
          if (holdNextWrite) {
            holdNextWrite = false;
            await new Promise(resolve => { releasePendingWrite = resolve; });
          }
          return fn();
        });
      },
    };

    const { dom, restore } = await mountBuiltApp({
      initialHash: '#/lawyer/profile',
      storage,
      locks: deferredLocks,
    });

    try {
      const view = dom.document.getElementById('view');
      const officeIn = dom.document.getElementById('pe-office');
      const saveBtn = view.querySelector('button[type="button"][data-submit]');

      officeIn.value = '初稿法律事務所';
      await officeIn.dispatch('input');

      const firstSave = saveBtn.dispatch('click');
      await flushMicrotasks();
      assert.ok(releasePendingWrite, 'Profile save must be pending');

      officeIn.value = '初稿法律事務所・保存中追記';
      await officeIn.dispatch('input');

      releasePendingWrite();
      await firstSave;
      await flushMicrotasks();

      const v1 = JSON.parse(storage.getItem(STORAGE_KEY));
      assert.equal(v1.revision, 1);
      assert.equal(v1.data.lawyerProfile.office_name, '初稿法律事務所');
      assert.equal(officeIn.value, '初稿法律事務所・保存中追記', 'In-flight office_name edit must NOT be wiped by applyProfileToForm');

      await saveBtn.dispatch('click');
      await flushMicrotasks();

      const v2 = JSON.parse(storage.getItem(STORAGE_KEY));
      assert.equal(v2.revision, 2);
      assert.equal(v2.data.lawyerProfile.office_name, '初稿法律事務所・保存中追記');
    } finally {
      restore();
    }
  }

  // Part 2: #/lawyer/onboarding (must NOT navigate away and wipe unsaved in-flight edits)
  {
    const storage = createMemoryStorage();
    const baseLocks = createQueuingLocks();
    let releasePendingWrite = null;
    let holdNextWrite = true;

    const deferredLocks = {
      request(name, fn) {
        return baseLocks.request(name, async () => {
          if (holdNextWrite) {
            holdNextWrite = false;
            await new Promise(resolve => { releasePendingWrite = resolve; });
          }
          return fn();
        });
      },
    };

    const { dom, restore } = await mountBuiltApp({
      initialHash: '#/lawyer/onboarding',
      storage,
      locks: deferredLocks,
    });

    try {
      const view = dom.document.getElementById('view');
      const nameIn = dom.document.getElementById('ob-name');
      const barIn = dom.document.getElementById('ob-bar');
      const regIn = dom.document.getElementById('ob-reg');
      const officeIn = dom.document.getElementById('ob-office');
      const phoneIn = dom.document.getElementById('ob-phone');
      const submitBtn = view.querySelector('button[type="button"][data-submit]');

      nameIn.value = '佐藤 追記確認（架空サンプル）';
      barIn.value = '東京弁護士会';
      regIn.value = '995555';
      officeIn.value = '追記確認法律事務所';
      phoneIn.value = '03-0000-1111';

      const firstSave = submitBtn.dispatch('click');
      await flushMicrotasks();
      assert.ok(releasePendingWrite, 'Onboarding save must be pending');

      // User modifies phone while save is in flight
      phoneIn.value = '03-0000-2222';
      await phoneIn.dispatch('input');

      releasePendingWrite();
      await firstSave;
      await flushMicrotasks();

      // Must remain on #/lawyer/onboarding and preserve in-flight phone edit
      assert.equal(dom.location.hash, '#/lawyer/onboarding', 'Must NOT navigate away when unsaved in-flight edits exist');
      assert.equal(phoneIn.value, '03-0000-2222');
      const v1 = JSON.parse(storage.getItem(STORAGE_KEY));
      assert.equal(v1.revision, 1);
      assert.equal(v1.data.lawyerProfile.phone, '03-0000-1111');

      // Subsequent submit persists "03-0000-2222" and navigates to #/lawyer/profile
      await submitBtn.dispatch('click');
      await flushMicrotasks();

      assert.equal(dom.location.hash, '#/lawyer/profile');
      const v2 = JSON.parse(storage.getItem(STORAGE_KEY));
      assert.equal(v2.revision, 2);
      assert.equal(v2.data.lawyerProfile.phone, '03-0000-2222');
    } finally {
      restore();
    }
  }
});

test('dist/app.js no longer swallows persistState errors with empty catch and dist/storage.js has no unguarded localStorage.setItem fallback', () => {
  const srcApp = readFileSync(resolve(appRoot, 'src/app.js'), 'utf8');
  assert.ok(!/catch\s*\{\s*\/\*\s*ignore\s*\*\/\s*\}/.test(srcApp), 'src/app.js must not silently ignore storage errors');
  assert.match(srcApp, /persistLocalState/);

  const srcStorage = readFileSync(resolve(appRoot, 'src/storage.js'), 'utf8');
  assert.ok(!/\.setItem\s*\(/.test(srcStorage), 'src/storage.js must not bypass Web Locks with raw localStorage.setItem');
});
