import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emptyDraft, draftProblems, recipientProblems, assembleMemo, addressedMemo} from '../src/model.js';
import {translator} from '../src/messages.js';
import {
  runtimeDescriptor, disclosureFacts, REQUESTED_CAPABILITIES, SEND_SELECTOR, SEND_OPERATION, INFERENCE_OPERATION,
} from '../src/operations.js';
import {createShareHandler, createWebParityHandler} from '../src/send.js';
import {
  clientRuntimeProblems, clientRuntimeConnectSrc, clientDisclosureProblems,
  effectiveClientOperations, createClientOperationBroker, createClientConsentHost,
} from '../../../otehon/shell/vendor/kotoba-client-runtime.js';

const t = translator('ja');
function fixture() {
  return {
    ...emptyDraft(),
    jurisdiction: 'JPN', category: 'money', summary: '友人に50万円を貸したが返ってこない。',
    timeline: [{date: '2026-03-01', event: '50万円を振り込んだ'}], otherParty: '友人A', wish: '返してほしい',
    documents: ['振込明細'], name: '山田太郎', contact: 'taro@example.com',
    recipient: {name: '鈴木花子', office: '鈴木法律事務所', contact: 'hanako@example.jp'},
  };
}

let nowMs = 0;
class FakeMouseEvent { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } }
function makeDocument() {
  const elements = [];
  const makeElement = tag => {
    const el = {
      tag, children: [], textContent: '', className: '', disabled: false, open: false, _listeners: new Map(),
      setAttribute() {}, append(...kids) { el.children.push(...kids); },
      addEventListener(type, fn) { if (!el._listeners.has(type)) el._listeners.set(type, []); el._listeners.get(type).push(fn); },
      removeEventListener() {}, focus() {},
      showModal() { el.open = true; },
      close() { if (!el.open) return; el.open = false; for (const fn of [...(el._listeners.get('close') ?? [])]) fn({type: 'close'}); },
      remove() {}, get isConnected() { return true; },
    };
    elements.push(el); return el;
  };
  const doc = {body: makeElement('body'), createElement: makeElement, defaultView: {MouseEvent: FakeMouseEvent, performance: {now: () => nowMs}}};
  return {doc, elements};
}
function fire(el, type, event) { event.currentTarget = el; for (const fn of [...(el._listeners.get(type) ?? [])]) fn(event); }
function installedDocument() {
  const {doc, elements} = makeDocument();
  globalThis.document = doc;
  return {doc, elements, dialog: () => elements.find(e => e.tag === 'dialog'), scope: () => elements.find(e => e.className === 'kotoba-client-consent-scope')};
}

function wire({approved = true, supported = true, shareText, adapter = null, doc, locale = 'ja'} = {}) {
  const calls = [];
  const share = shareText ?? (async text => { calls.push(text); });
  const descriptor = runtimeDescriptor(locale);
  const host = [SEND_SELECTOR.capability, SEND_SELECTOR.service, SEND_SELECTOR.operation];
  const consentHost = createClientConsentHost({document: doc, locale});
  const broker = createClientOperationBroker({
    runtime: descriptor,
    requestedCapabilities: [...REQUESTED_CAPABILITIES],
    approvedOperations: approved ? descriptor.operations : [],
    hostSupportedOperations: supported ? [host] : [],
    browserAdapters: supported ? {[SEND_SELECTOR.service]: {[SEND_SELECTOR.operation]: adapter ?? createShareHandler({shareText: share})}} : {},
    consentHost,
    app: {name: translator(locale)('app.title')},
  });
  return {descriptor, broker, calls};
}
function flatDialog(dialog) { return [...dialog.children].flatMap(c => [c, ...(c.children ?? [])]); }
function buttonByText(dialog, text) { return flatDialog(dialog).find(e => e.textContent === text && e.tag === 'button') ?? null; }
async function approve(dialog, allow) {
  nowMs += 1000;
  fire(allow, 'pointerdown', {type: 'pointerdown', isTrusted: true});
  fire(allow, 'click', new FakeMouseEvent('click', {isTrusted: true}));
}
function memoPayload() {
  const d = fixture();
  assert.deepEqual(draftProblems(d), []);
  assert.deepEqual(recipientProblems(d.recipient), []);
  const to = {name: d.recipient.name, office: d.recipient.office, contact: d.recipient.contact};
  return {memo: addressedMemo(assembleMemo(d, t).text, to, t), recipient: to};
}

test('the restricted-wasm-v1 descriptor declares O1/D9 send and murakumo.cloud with finding-9 disclosures', () => {
  const d = runtimeDescriptor();
  const origins = ['https://soudan.itonami.app', 'http://tauri.localhost'];
  assert.deepEqual(clientRuntimeProblems(d, [...REQUESTED_CAPABILITIES], origins), []);
  assert.equal(d.profile, 'restricted-wasm-v1');
  assert.equal(d.operations.length, 2);
  assert.deepEqual(d.operations[0], SEND_OPERATION);
  assert.deepEqual(d.operations[1], INFERENCE_OPERATION);
  assert.equal(SEND_OPERATION.consent, 'each-operation');
  assert.deepEqual(SEND_OPERATION['data-categories'], ['legal.consultation-memo']);
  assert.deepEqual(clientDisclosureProblems(SEND_OPERATION.disclosure), []);
  assert.deepEqual(clientDisclosureProblems(INFERENCE_OPERATION.disclosure), []);
  assert.equal(SEND_OPERATION.disclosure.country, 'JP');
  assert.equal(SEND_OPERATION.disclosure.frequency, 'one-time');
  assert.equal(SEND_OPERATION.disclosure['special-care'], true);
  assert.ok(SEND_OPERATION.disclosure['special-care-kinds'].length > 0);
  assert.deepEqual(SEND_OPERATION.endpoint, {'browser-action': 'share', recipient: 'user-selected-app'});
  assert.ok(!('origin' in SEND_OPERATION.endpoint));
  assert.equal(clientRuntimeConnectSrc(d, [...REQUESTED_CAPABILITIES], [], origins), 'connect-src https://api.murakumo.cloud');
});

test('approval hands the consultation memo over exactly once', async () => {
  const {doc, dialog, scope} = installedDocument();
  try {
    const {broker, calls} = wire({doc});
    assert.equal(broker.operations.length, 1);
    const payload = memoPayload();
    const invoked = broker.invoke(SEND_SELECTOR, payload);
    assert.equal(dialog().open, true, 'consent is showing');
    const allow = buttonByText(dialog(), '許可する');
    assert.ok(allow, 'allow button exists');
    await approve(dialog(), allow);
    assert.deepEqual(await invoked, {shared: true, route: 'android-share-sheet'});
    assert.equal(calls.length, 1, 'exactly one hand-off');
    assert.equal(calls[0], payload.memo, 'the memo text as assembled');
    assert.match(scope().textContent, /Receiver: the app you pick next receives the data/);
    assert.match(scope().textContent, /legal\.consultation-memo/);
  } finally { delete globalThis.document; }
});

test('denial hands nothing over', async () => {
  const {doc, dialog} = installedDocument();
  try {
    const {broker, calls} = wire({doc});
    const payload = memoPayload();
    const invoked = broker.invoke(SEND_SELECTOR, payload);
    assert.equal(dialog().open, true);
    const deny = buttonByText(dialog(), '許可しない');
    assert.ok(deny, 'deny button exists');
    fire(deny, 'click', {type: 'click', isTrusted: true});
    await assert.rejects(invoked, /not approved/);
    assert.equal(calls.length, 0, 'no hand-off on denial');
  } finally { delete globalThis.document; }
});

test('approval hands a memo with the lawyer-facing evidence list over exactly once, as text only', async () => {
  const {doc, dialog} = installedDocument();
  try {
    const {broker, calls} = wire({doc});
    const d = fixture();
    d.evidence = [{
      url: 'https://example.com/posts/123', postedAt: '2026-11-20T21:00', authorName: '表示名', authorId: 'user123',
      shotName: 'shot.png', shotSize: 12345, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      capturedAt: '2026-11-21T10:00:00.000Z',
    }];
    assert.deepEqual(draftProblems(d), []);
    const to = {name: d.recipient.name, office: d.recipient.office, contact: d.recipient.contact};
    const payload = {memo: addressedMemo(assembleMemo(d, t).text, to, t), recipient: to};
    const invoked = broker.invoke(SEND_SELECTOR, payload);
    const allow = buttonByText(dialog(), '許可する');
    assert.ok(allow, 'allow button exists');
    await approve(dialog(), allow);
    assert.deepEqual(await invoked, {shared: true, route: 'android-share-sheet'});
    assert.equal(calls.length, 1, 'exactly one hand-off');
    assert.ok(calls[0].includes('弁護士に見せるための一覧'));
    assert.ok(calls[0].includes('https://example.com/posts/123'));
    assert.ok(!calls[0].includes('data:image'), 'no image bytes cross the send gate');
  } finally { delete globalThis.document; }
});

test('Web parity export (.txt, .md, export.v1 .json, Web Share, clipboard) runs behind the same canonical consent gate', async () => {
  const {doc, dialog} = installedDocument();
  try {
    const saved = [], shared = [], copied = [];
    const webAdapter = createWebParityHandler({
      webShare: async data => shared.push(data),
      saveFile: async file => saved.push(file),
      copyText: async text => copied.push(text),
    });
    const {broker} = wire({doc, adapter: webAdapter});
    const base = memoPayload();

    for (const mode of ['web-share', 'save-txt', 'save-md', 'save-json', 'clipboard']) {
      const invoked = broker.invoke(SEND_SELECTOR, {
        ...base,
        mode,
        title: '相談メモ',
        markdown: '# 相談メモ\n' + base.memo,
        exportJson: JSON.stringify({schema: 'soudan.memo.export.v1', text: base.memo}),
      });
      await approve(dialog(), buttonByText(dialog(), '許可する'));
      await invoked;
    }
    assert.equal(shared.length, 1);
    assert.equal(saved.length, 3);
    assert.deepEqual(saved.map(f => f.name), ['soudan-memo.txt', 'soudan-memo.md', 'soudan-memo.json']);
    assert.equal(copied.length, 1);

    // Denial leaves nothing exported.
    const denied = broker.invoke(SEND_SELECTOR, {...base, mode: 'save-txt'});
    fire(buttonByText(dialog(), '許可しない'), 'click', {type: 'click', isTrusted: true});
    await assert.rejects(denied, /not approved/);
    assert.equal(saved.length, 3);
  } finally { delete globalThis.document; }
});

test('without governor approval the send is not eligible and nothing is handed over', async () => {
  const {doc} = installedDocument();
  try {
    const {descriptor, broker, calls} = wire({doc, approved: false});
    assert.deepEqual(effectiveClientOperations(descriptor, {
      requestedCapabilities: [...REQUESTED_CAPABILITIES],
      approvedOperations: [],
      hostSupportedOperations: [[SEND_SELECTOR.capability, SEND_SELECTOR.service, SEND_SELECTOR.operation]],
    }), []);
    assert.equal(broker.operations.length, 0);
    await assert.rejects(broker.invoke(SEND_SELECTOR, memoPayload()), /not eligible/);
    assert.equal(calls.length, 0);
  } finally { delete globalThis.document; }
});

test('without host support the send is not eligible and nothing is handed over', async () => {
  const {doc} = installedDocument();
  try {
    const {descriptor, broker, calls} = wire({doc, supported: false});
    assert.deepEqual(effectiveClientOperations(descriptor, {
      requestedCapabilities: [...REQUESTED_CAPABILITIES],
      approvedOperations: descriptor.operations,
      hostSupportedOperations: [],
    }), []);
    assert.equal(broker.operations.length, 0);
    await assert.rejects(broker.invoke(SEND_SELECTOR, memoPayload()), /not eligible/);
    assert.equal(calls.length, 0);
  } finally { delete globalThis.document; }
});

test('when the device language is Japanese the restricted-wasm-v1 consent dialog is Japanese', async () => {
  const {doc, dialog, scope} = installedDocument();
  try {
    const {broker, calls} = wire({doc, locale: 'ja'});
    const payload = memoPayload();
    const invoked = broker.invoke(SEND_SELECTOR, payload);
    assert.equal(dialog().open, true, 'consent is showing');
    assert.equal(flatDialog(dialog()).find(e => e.tag === 'h2')?.textContent, 'Soudan — 自己整理メモツール が、次の情報を送ろうとしています');
    const summary = flatDialog(dialog()).find(e => e.tag === 'ul');
    assert.match(summary?.textContent ?? '', /送り先: 利用者がこの端末で選ぶアプリ（日本）/);
    assert.match(summary?.textContent ?? '', /送る情報: 相談メモ（氏名、連絡先、相談内容）/);
    assert.match(summary?.textContent ?? '', /目的: 利用者が選んだ弁護士に相談メモを送る/);
    assert.match(summary?.textContent ?? '', /送る回数: 1 回だけ/);
    const allow = buttonByText(dialog(), '許可する');
    const deny = buttonByText(dialog(), '許可しない');
    assert.ok(allow, 'Japanese allow button exists');
    assert.ok(deny, 'Japanese deny button exists');
    assert.match(scope().textContent, /Receiver: the app you pick next receives the data/);
    assert.match(scope().textContent, /legal\.consultation-memo/);
    await approve(dialog(), allow);
    assert.deepEqual(await invoked, {shared: true, route: 'android-share-sheet'});
    assert.equal(calls.length, 1, 'exactly one hand-off');
    assert.equal(calls[0], payload.memo, 'the addressed memo text as assembled');
  } finally { delete globalThis.document; }
});

test('an English device language shows the English restricted-wasm-v1 dialog with English declared facts', async () => {
  const {doc, dialog, scope} = installedDocument();
  try {
    const {broker, calls} = wire({doc, locale: 'en'});
    const payload = memoPayload();
    const invoked = broker.invoke(SEND_SELECTOR, payload);
    assert.equal(dialog().open, true, 'consent is showing');
    assert.equal(flatDialog(dialog()).find(e => e.tag === 'h2')?.textContent, 'Soudan — Self-organization consultation memo tool wants to send the following information');
    const summary = flatDialog(dialog()).find(e => e.tag === 'ul');
    assert.match(summary?.textContent ?? '', /Recipient: the app you choose on this device \(Japan\)/);
    assert.match(summary?.textContent ?? '', /Information: consultation memo \(name, contact, consultation details\)/);
    assert.match(summary?.textContent ?? '', /Purpose: to send the consultation memo to the lawyer you chose/);
    assert.match(summary?.textContent ?? '', /Frequency: Once/);
    assert.match(flatDialog(dialog()).map(e => e.textContent ?? '').join('\n'), /not saved/);
    const allow = buttonByText(dialog(), 'Allow');
    const deny = buttonByText(dialog(), "Don't allow");
    assert.ok(allow, 'English allow button exists');
    assert.ok(deny, 'English deny button exists');
    assert.match(scope().textContent, /Receiver: the app you pick next receives the data/);
    assert.match(scope().textContent, /legal\.consultation-memo/);
    await approve(dialog(), allow);
    assert.deepEqual(await invoked, {shared: true, route: 'android-share-sheet'});
    assert.equal(calls.length, 1, 'exactly one hand-off');
    assert.equal(calls[0], payload.memo, 'the addressed memo text as assembled');
  } finally { delete globalThis.document; }
});

test('the declared disclosure facts follow the dialog language, and the default stays Japanese', () => {
  assert.deepEqual(disclosureFacts(), disclosureFacts('ja'));
  assert.deepEqual(disclosureFacts('fr'), disclosureFacts('ja'), 'unknown locales fall back to Japanese');
  for (const locale of ['ja', 'en']) {
    const d = runtimeDescriptor(locale);
    assert.deepEqual(clientRuntimeProblems(d, [...REQUESTED_CAPABILITIES], ['https://soudan.itonami.app', 'http://tauri.localhost']), []);
    assert.deepEqual(clientDisclosureProblems(d.operations[0].disclosure), []);
    assert.deepEqual(clientDisclosureProblems(d.operations[1].disclosure), []);
    assert.equal(d.operations[0].disclosure.country, 'JP');
    assert.equal(d.operations[0].disclosure.frequency, 'one-time');
    assert.equal(d.operations[1].disclosure.country, 'US');
    assert.equal(d.operations[1].disclosure.frequency, 'one-time');
  }
  assert.deepEqual(runtimeDescriptor(), runtimeDescriptor('ja'), 'the default descriptor stays Japanese');
});

test('starting a new send clears the previous result line before consent (no stale notice behind the chooser)', () => {
  const src = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const handler = src.slice(src.indexOf("btn.addEventListener('click'"));
  assert.ok(handler.includes("say('')"), 'the previous result is cleared when a new send starts');
  assert.ok(handler.indexOf("say('')") < handler.indexOf("store.execute('soudan.memo.send'"), 'cleared before consent/chooser, not after');
});

test('the sent body heads with the destination the user typed and nothing else', async () => {
  const {doc, dialog} = installedDocument();
  try {
    const {broker, calls} = wire({doc});
    const payload = memoPayload();
    const invoked = broker.invoke(SEND_SELECTOR, payload);
    assert.equal(dialog().open, true);
    const allow = buttonByText(dialog(), '許可する');
    assert.ok(allow, 'allow button exists');
    await approve(dialog(), allow);
    assert.deepEqual(await invoked, {shared: true, route: 'android-share-sheet'});
    assert.equal(calls.length, 1);
    const [head, ...rest] = calls[0].split('\n');
    assert.equal(head, '宛先: 鈴木花子 / 鈴木法律事務所 / hanako@example.jp');
    assert.ok(rest.join('\n').includes('友人に50万円を貸したが返ってこない。'), 'user words are untouched');
    assert.ok(!calls[0].includes('候補'), 'no candidates added');
    assert.ok(!calls[0].includes('おすすめ'), 'no recommendations added');
  } finally { delete globalThis.document; }
});

test('an invalid payload or image data URL never reaches the share sheet', async () => {
  const calls = [];
  const handler = createShareHandler({shareText: async text => { calls.push(text); }});
  for (const payload of [undefined, {}, null, {memo: ''}, {memo: '   '}, {memo: 'あ'.repeat(65537)}]) {
    await assert.rejects(handler({payload}), /invalid-memo-payload/);
  }
  await assert.rejects(handler({payload: {memo: 'data:image/png;base64,AAAA'}}), /image-bytes-forbidden/);
  assert.equal(calls.length, 0);
  assert.deepEqual(await handler({payload: {memo: '相談メモ'}}), {shared: true, route: 'android-share-sheet'});
  assert.deepEqual(calls, ['相談メモ']);
  assert.throws(() => createShareHandler({}), /shareText-required/);
});
