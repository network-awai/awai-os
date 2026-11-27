import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHost } from '../../../packages/awai-shell/host.js';
import { persistLocalState, classifyStorageError, STORAGE_KEY } from '../src/storage.js';
import { createInitialLocalState, createOperationsEngine } from '../src/operations.js';
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

function createFakeLocks() {
  return {
    async request(_name, fn) {
      return await fn();
    },
  };
}

test('persistLocalState returns { ok: false, error, code, message } on localStorage QuotaExceededError and recovers on retry', async () => {
  const storage = createMemoryStorage();
  const host = createHost({ appId: 'network.itonami.bengoshi', storage, locks: null });
  const state = createInitialLocalState();
  state.lawyerProfile = structuredClone(SYNTHETIC_CATALOG_BUNDLE.lawyers[0]);

  storage.failWritesWith(makeQuotaError());
  const failed = await persistLocalState({ host, storage, revision: 0, state });

  assert.equal(failed.ok, false);
  assert.equal(failed.via, 'localStorage');
  assert.equal(failed.code, 'quota-exceeded');
  assert.equal(failed.error?.name, 'QuotaExceededError');
  assert.match(failed.message, /quota/i);
  assert.equal(storage.getItem(STORAGE_KEY), null);

  // Recover and retry
  storage.failWritesWith(null);
  const ok = await persistLocalState({ host, storage, revision: 0, state });
  assert.equal(ok.ok, true);
  assert.equal(ok.revision, 1);
  assert.equal(ok.via, 'localStorage');
  assert.ok(storage.getItem(STORAGE_KEY));
});

test('persistLocalState returns { ok: false, error, code, message } on localStorage SecurityError', async () => {
  const storage = createMemoryStorage();
  const host = createHost({ appId: 'network.itonami.bengoshi', storage, locks: null });
  storage.failWritesWith(makeSecurityError());

  const failed = await persistLocalState({ host, storage, revision: 0, state: createInitialLocalState() });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'storage-unavailable');
  assert.equal(failed.error?.name, 'SecurityError');
});

test('persistLocalState returns { ok: false, error, code, message } on host.write rejection (storage-unavailable, data-too-large, state-conflict)', async () => {
  const storage = createMemoryStorage();
  const host = createHost({ appId: 'network.itonami.bengoshi', storage, locks: createFakeLocks() });
  const state = createInitialLocalState();

  // Host storage write failure (storage.setItem throws inside host.write)
  storage.failWritesWith(makeQuotaError());
  const fail1 = await persistLocalState({ host, storage, revision: 0, state });
  assert.equal(fail1.ok, false);
  assert.equal(fail1.via, 'host');
  assert.equal(fail1.code, 'storage-unavailable');
  assert.equal(fail1.error?.code, 'storage-unavailable');

  // Recover and write revision 1
  storage.failWritesWith(null);
  const ok1 = await persistLocalState({ host, storage, revision: 0, state });
  assert.equal(ok1.ok, true);
  assert.equal(ok1.revision, 1);

  // Stale revision -> state-conflict
  const conflict = await persistLocalState({ host, storage, revision: 0, state });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'state-conflict');

  // Direct custom host rejection
  const failingHost = {
    async write() { throw Object.assign(new Error('disk full'), { code: 'data-too-large' }); },
  };
  const failCustom = await persistLocalState({ host: failingHost, storage, revision: 1, state });
  assert.equal(failCustom.ok, false);
  assert.equal(failCustom.code, 'quota-exceeded');
  assert.equal(classifyStorageError(failCustom.error).code, 'quota-exceeded');
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
async function mountBuiltApp({ initialHash = '#/guide', storage = createMemoryStorage(), locks = null } = {}) {
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

  return { dom, mod, storage, restore };
}

async function flushMicrotasks() {
  for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 5));
}

test('UI regression (#/lawyer/onboarding): QuotaExceededError blocks navigation, preserves input, shows role="alert" error (not success), and succeeds on retry', async () => {
  const storage = createMemoryStorage();
  const { dom, restore } = await mountBuiltApp({ initialHash: '#/lawyer/onboarding', storage, locks: null });
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

    // Inject browser localStorage QuotaExceededError
    storage.failWritesWith(makeQuotaError());
    const submitBtn = view.querySelector('button[type="button"][data-submit]');
    await submitBtn.dispatch('click');
    await flushMicrotasks();

    // Must NOT navigate away from onboarding
    assert.equal(dom.location.hash, '#/lawyer/onboarding');
    // Must preserve ALL user inputs without re-typing
    assert.equal(dom.document.getElementById('ob-name').value, '山田 検証（架空サンプル）');
    assert.equal(dom.document.getElementById('ob-kana').value, 'やまだ けんしょう');
    assert.equal(dom.document.getElementById('ob-bar').value, '東京弁護士会');
    assert.equal(dom.document.getElementById('ob-reg').value, '991234');
    assert.equal(dom.document.getElementById('ob-office').value, '検証テスト法律事務所');
    assert.equal(dom.document.getElementById('ob-phone').value, '03-0000-1234');

    // Must show visible role="alert" error banner and NO success message
    const alerts = view.querySelectorAll('[role="alert"]').filter(n => !n.hidden);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].textContent, /端末ストレージへの保存に失敗しました/);
    assert.match(alerts[0].textContent, /容量/);
    assert.equal(dom.document.getElementById('status').textContent, '');
    assert.equal(storage.getItem(STORAGE_KEY), null);

    // Recover storage and retry immediately without re-typing
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

test('UI regression (#/lawyer/onboarding): host storage write rejection keeps route & inputs intact and succeeds on retry', async () => {
  const storage = createMemoryStorage();
  const { dom, restore } = await mountBuiltApp({
    initialHash: '#/lawyer/onboarding',
    storage,
    locks: createFakeLocks(),
  });
  try {
    const view = dom.document.getElementById('view');
    dom.document.getElementById('ob-name').value = '鈴木 試験（架空サンプル）';
    dom.document.getElementById('ob-bar').value = '大阪弁護士会';
    dom.document.getElementById('ob-reg').value = '995678';
    dom.document.getElementById('ob-office').value = '大阪試験法律事務所';
    dom.document.getElementById('ob-phone').value = '06-0000-5678';

    // Host write throws HostError('storage-unavailable') when storage.setItem rejects
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

    // Retry after host write recovers
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

  const { dom, restore } = await mountBuiltApp({ initialHash: '#/lawyer/profile', storage, locks: null });
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
    // Storage still has original office_name
    assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).data.lawyerProfile.office_name, seedState.lawyerProfile.office_name);

    // Retry after recovery
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
  const { dom, restore } = await mountBuiltApp({ initialHash: '#/contact/compose', storage, locks: null });
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

    // Retry after recovery
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
  const { dom, restore } = await mountBuiltApp({ initialHash: '#/lawyer/inbox', storage, locks: null });
  try {
    // Seed QA inquiries cleanly first
    const view = dom.document.getElementById('view');
    const seedBtn = view.querySelectorAll('button').find(b => b.textContent.includes('架空QA暗号化問い合わせ'));
    assert.ok(seedBtn, 'Seed QA button must exist');
    await seedBtn.dispatch('click');
    await flushMicrotasks();

    // Open clear inquiry detail
    dom.location.hash = '#/lawyer/inquiry/inq-qa-clear-001';
    await flushMicrotasks();

    // Run local conflict check (succeeds)
    const runBtn = view.querySelectorAll('button').find(b => b.textContent.includes('利益相反チェックを実行'));
    assert.ok(runBtn, 'Run conflict check button must exist');
    await runBtn.dispatch('click');
    await flushMicrotasks();

    // Now fail storage when lawyer tries to confirm clear
    const confirmBox = view.querySelector('input[type="checkbox"]');
    assert.ok(confirmBox, 'Conflict confirmation checkbox must exist');
    storage.failWritesWith(makeQuotaError());
    confirmBox.checked = true;
    await confirmBox.dispatch('change');
    await flushMicrotasks();

    // Checkbox must revert to false and reveal button remains disabled
    assert.equal(confirmBox.checked, false);
    const revealBtn = view.querySelectorAll('button').find(b => b.textContent.includes('復号・閲覧'));
    assert.equal(revealBtn.disabled, true);
    const visibleAlerts = view.querySelectorAll('[role="alert"]').filter(n => !n.hidden);
    assert.equal(visibleAlerts.length, 1);
    assert.match(visibleAlerts[0].textContent, /端末ストレージへの保存に失敗しました/);

    // Recover storage and retry confirmation
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

test('dist/app.js no longer swallows persistState errors with empty catch', () => {
  const srcApp = readFileSync(resolve(appRoot, 'src/app.js'), 'utf8');
  assert.ok(!/catch\s*\{\s*\/\*\s*ignore\s*\*\/\s*\}/.test(srcApp), 'src/app.js must not silently ignore storage errors');
  assert.match(srcApp, /persistLocalState/);
});
