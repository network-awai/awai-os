import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateLawyerKeyPair,
  encryptEnvelope,
  decryptEnvelope,
  verifyEnvelopeHasNoPlaintext,
} from '../src/crypto.js';
import {
  runtimeDescriptor,
  REQUESTED_CAPABILITIES,
  INFERENCE_SELECTOR,
  INQUIRY_SEND_SELECTOR,
  INQUIRY_REPLY_SELECTOR,
} from '../src/runtime-descriptor.js';
import { createOperationsEngine } from '../src/operations.js';
import {
  clientRuntimeProblems,
  clientRuntimeConnectSrc,
  clientDisclosureProblems,
  createClientOperationBroker,
  createClientConsentHost,
} from '../../../otehon/shell/vendor/kotoba-client-runtime.js';

const NOW = '2026-11-27T09:00:00Z';

// Minimal trusted DOM stand-in matching apps/soudan/test/send.test.mjs
let nowMs = 0;
class FakeMouseEvent { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } }
function makeDocument() {
  const elements = [];
  const makeElement = tag => {
    const el = {
      tag, children: [], textContent: '', className: '', disabled: false, open: false, _listeners: new Map(),
      setAttribute() {},
      append(...kids) { el.children.push(...kids); },
      addEventListener(type, fn) { if (!el._listeners.has(type)) el._listeners.set(type, []); el._listeners.get(type).push(fn); },
      removeEventListener() {},
      focus() {},
      showModal() { el.open = true; },
      close() { if (!el.open) return; el.open = false; for (const fn of [...(el._listeners.get('close') ?? [])]) fn({ type: 'close' }); },
      remove() {},
      get isConnected() { return true; },
    };
    elements.push(el);
    return el;
  };
  const doc = { body: makeElement('body'), createElement: makeElement, defaultView: { MouseEvent: FakeMouseEvent, performance: { now: () => nowMs } } };
  return { doc, elements };
}
function fire(el, type, event) { event.currentTarget = el; for (const fn of [...(el._listeners.get(type) ?? [])]) fn(event); }
function flatDialog(dialog) { return [...dialog.children].flatMap(c => [c, ...(c.children ?? [])]); }
function buttonByText(dialog, text) { return flatDialog(dialog).find(e => e.textContent === text && e.tag === 'button') ?? null; }
async function waitForDialog(elements, timeoutMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const dialog = elements.find(e => e.tag === 'dialog');
    if (dialog && dialog.open) return dialog;
    await new Promise(r => setTimeout(r, 5));
  }
  throw new Error('consent-dialog-did-not-open');
}
async function approve(allow) {
  nowMs += 1000;
  fire(allow, 'pointerdown', { type: 'pointerdown', isTrusted: true });
  fire(allow, 'click', new FakeMouseEvent('click', { isTrusted: true }));
}

test('O8 E2EE envelope encrypts client-side, hides plaintext, decrypts with private key, and rejects AAD tampering', async () => {
  const kp = await generateLawyerKeyPair();
  const secretSummary = '極めて機密性の高い労働紛争相談内容・証拠番号XY-9988';
  const conflictHeader = {
    inquiryId: 'inq-e2ee-1',
    clientName: '山田太郎',
    counterpartyName: '相手方株式会社',
    category: 'work',
    receivedAt: NOW,
  };
  const envelope = await encryptEnvelope({
    recipientLawyerId: 'syn-lawyer-990001',
    recipientPublicKeyJwk: kp.publicKeyJwk,
    conflictHeader,
    plaintext: { summary: secretSummary, clientContact: 'secret@example.invalid' },
  });

  assert.equal(envelope.schema, 'bengoshi.e2ee.envelope.v1');
  assert.equal(verifyEnvelopeHasNoPlaintext(envelope, [secretSummary, 'secret@example.invalid']).ok, true);

  const decrypted = await decryptEnvelope({ envelope, recipientPrivateKeyJwk: kp.privateKeyJwk });
  assert.equal(decrypted.summary, secretSummary);

  // Tamper AAD / conflictHeader -> must fail decryption
  const tampered = { ...envelope, conflictHeader: { ...conflictHeader, counterpartyName: '改ざん企業' } };
  await assert.rejects(() => decryptEnvelope({ envelope: tampered, recipientPrivateKeyJwk: kp.privateKeyJwk }), /e2ee-aad-mismatch/);
});

test('runtime descriptor passes canonical validator with AWAI-3883 pending countryStatus for murakumo.cloud and zero app-origin', () => {
  for (const locale of ['ja', 'en']) {
    const d = runtimeDescriptor(locale);
    assert.deepEqual(clientRuntimeProblems(d, [...REQUESTED_CAPABILITIES], 'https://bengoshi.itonami.app'), []);
    assert.equal(clientRuntimeConnectSrc(d, [...REQUESTED_CAPABILITIES], [], 'https://bengoshi.itonami.app'), 'connect-src https://murakumo.cloud');
    for (const op of d.operations) {
      assert.equal(op.consent, 'each-operation');
      assert.deepEqual(clientDisclosureProblems(op.disclosure), []);
      assert.equal(op.disclosure.frequency, 'one-time');
    }
    const infOp = d.operations.find(o => o.operation === INFERENCE_SELECTOR.operation);
    assert.equal(infOp.disclosure.countryStatus, 'pending');
    assert.equal(infOp.disclosure.country, null);
    assert.ok(infOp.disclosure.note.length > 0);
    assert.ok(infOp.disclosure.confirmCondition.length > 0);
  }
});

test('consent denial on inquiry.send sends 0 bytes and records audit denial', async () => {
  const { doc, elements } = makeDocument();
  globalThis.document = doc;
  const dispatched = [];
  try {
    const descriptor = runtimeDescriptor('ja');
    const consentHost = createClientConsentHost({ document: doc, locale: 'ja' });
    const broker = createClientOperationBroker({
      runtime: descriptor,
      requestedCapabilities: [...REQUESTED_CAPABILITIES],
      approvedOperations: descriptor.operations,
      hostSupportedOperations: [
        [INQUIRY_SEND_SELECTOR.capability, INQUIRY_SEND_SELECTOR.service, INQUIRY_SEND_SELECTOR.operation],
        [INQUIRY_REPLY_SELECTOR.capability, INQUIRY_REPLY_SELECTOR.service, INQUIRY_REPLY_SELECTOR.operation],
      ],
      browserAdapters: {
        [INQUIRY_SEND_SELECTOR.service]: {
          [INQUIRY_SEND_SELECTOR.operation]: async ({ payload }) => { dispatched.push(payload); return { accepted: true }; },
        },
      },
      consentHost,
      app: { name: '弁護士ディレクトリ（Bengoshi）' },
    });

    const engine = createOperationsEngine({ broker, now: () => NOW });
    const draft = {
      lawyerId: 'syn-lawyer-990001',
      category: 'money',
      clientName: '相談者A',
      clientContact: 'a@example.invalid',
      counterpartyName: '相手方B',
      summary: '返還請求についての相談です。',
      evidenceHashes: [],
    };

    const p = engine.execute('inquiry.send', { draft, dryRun: true });
    const dialog = await waitForDialog(elements);
    assert.equal(dialog.open, true);
    const deny = buttonByText(dialog, '閉じる');
    fire(deny, 'click', { type: 'click', isTrusted: true });

    await assert.rejects(p, /not approved/);
    assert.equal(dispatched.length, 0, 'Denial must send 0 bytes');

    const audit = await engine.execute('audit.list');
    assert.equal(audit.entries[0].outcome, 'denied');
  } finally {
    delete globalThis.document;
  }
});

test('consent approval on inquiry.send dispatches E2EE envelope exactly once with zero plaintext', async () => {
  const { doc, elements } = makeDocument();
  globalThis.document = doc;
  const dispatched = [];
  try {
    const descriptor = runtimeDescriptor('ja');
    const consentHost = createClientConsentHost({ document: doc, locale: 'ja' });
    const broker = createClientOperationBroker({
      runtime: descriptor,
      requestedCapabilities: [...REQUESTED_CAPABILITIES],
      approvedOperations: descriptor.operations,
      hostSupportedOperations: [
        [INQUIRY_SEND_SELECTOR.capability, INQUIRY_SEND_SELECTOR.service, INQUIRY_SEND_SELECTOR.operation],
      ],
      browserAdapters: {
        [INQUIRY_SEND_SELECTOR.service]: {
          [INQUIRY_SEND_SELECTOR.operation]: async ({ payload }) => { dispatched.push(payload); return { accepted: true }; },
        },
      },
      consentHost,
      app: { name: '弁護士ディレクトリ（Bengoshi）' },
    });

    const engine = createOperationsEngine({ broker, now: () => NOW });
    const secretText = '秘密の相談内容_SECRET_999';
    const draft = {
      lawyerId: 'syn-lawyer-990001',
      category: 'money',
      clientName: '相談者A',
      clientContact: 'a@example.invalid',
      counterpartyName: '相手方B',
      summary: secretText,
      evidenceHashes: [],
    };

    const p = engine.execute('inquiry.send', { draft, dryRun: true });
    const dialog = await waitForDialog(elements);
    assert.equal(dialog.open, true);
    await approve(buttonByText(dialog, '続ける'));
    const res = await p;

    assert.equal(dispatched.length, 1);
    assert.equal(verifyEnvelopeHasNoPlaintext(dispatched[0].envelope, [secretText]).ok, true);
    assert.equal(res.record.relayStatus, 'staged_local_dry_run');
  } finally {
    delete globalThis.document;
  }
});

test('staged relay fails closed when requireLiveRelay is true without verified endpoint', async () => {
  const fakeBroker = { invoke: async () => { throw new Error('should-not-reach'); } };
  const engine = createOperationsEngine({ broker: fakeBroker, now: () => NOW });
  await assert.rejects(
    () => engine.execute('inquiry.send', {
      draft: {
        lawyerId: 'syn-lawyer-990001',
        category: 'other',
        clientName: 'A',
        clientContact: 'a@example.invalid',
        counterpartyName: 'B',
        summary: 'テスト相談',
      },
      requireLiveRelay: true,
    }),
    /relay-staged-disabled/,
  );
});

test('inference.assist to murakumo.cloud denies cleanly with 0 fetch calls, and succeeds only after consent', async () => {
  const { doc, elements } = makeDocument();
  globalThis.document = doc;
  const origFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (req) => {
    fetchCalls.push(req);
    const res = new Response(JSON.stringify({ choices: [{ message: { content: '■ 概要\n整理済み下書き' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    Object.defineProperty(res, 'url', { value: 'https://murakumo.cloud/v1/chat/completions' });
    return res;
  };
  try {
    const descriptor = runtimeDescriptor('ja');
    const consentHost = createClientConsentHost({ document: doc, locale: 'ja' });
    const broker = createClientOperationBroker({
      runtime: descriptor,
      requestedCapabilities: [...REQUESTED_CAPABILITIES],
      approvedOperations: descriptor.operations,
      hostSupportedOperations: [
        [INFERENCE_SELECTOR.capability, INFERENCE_SELECTOR.service, INFERENCE_SELECTOR.operation],
      ],
      consentHost,
      app: { name: '弁護士ディレクトリ（Bengoshi）' },
    });

    const engine = createOperationsEngine({ broker, now: () => NOW });

    // 1. Deny -> 0 fetches
    const pDeny = engine.execute('inference.assist', { rawText: 'メモを整理したい' });
    const dialog1 = await waitForDialog(elements);
    fire(buttonByText(dialog1, '閉じる'), 'click', { type: 'click', isTrusted: true });
    await assert.rejects(pDeny, /not approved/);
    assert.equal(fetchCalls.length, 0);

    // 2. Approve -> exactly 1 fetch to https://murakumo.cloud/v1/chat/completions
    const pAllow = engine.execute('inference.assist', { rawText: 'メモを整理したい' });
    const dialog2 = await waitForDialog(elements);
    await approve(buttonByText(dialog2, '続ける'));
    const out = await pAllow;
    assert.equal(fetchCalls.length, 1);
    assert.equal(out.origin, 'https://murakumo.cloud');
    assert.equal(out.nonRetention, true);
    assert.equal(out.noLegalAdvice, true);
    assert.match(out.structuredDraft, /整理済み下書き/);
  } finally {
    globalThis.fetch = origFetch;
    delete globalThis.document;
  }
});
