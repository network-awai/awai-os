import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateLawyerKeyPair,
  encryptEnvelope,
  decryptEnvelope,
  verifyEnvelopeHasNoPlaintext,
} from '../src/crypto.js';
import { runtimeDescriptor, REQUESTED_CAPABILITIES } from '../src/runtime-descriptor.js';
import { sanitizeEntryLocation } from '../src/model.js';
import { createOperationsEngine } from '../src/operations.js';
import {
  clientRuntimeProblems,
  clientRuntimeConnectSrc,
} from '../../../otehon/shell/vendor/kotoba-client-runtime.js';

const NOW = '2026-11-27T09:00:00Z';

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

  const tampered = { ...envelope, conflictHeader: { ...conflictHeader, counterpartyName: '改ざん企業' } };
  await assert.rejects(() => decryptEnvelope({ envelope: tampered, recipientPrivateKeyJwk: kp.privateKeyJwk }), /e2ee-aad-mismatch/);
});

test('runtime descriptor declares operations: [] (zero external network calls) and derives connect-src none', () => {
  const d = runtimeDescriptor();
  assert.deepEqual(d.operations, []);
  assert.deepEqual([...REQUESTED_CAPABILITIES], []);
  assert.deepEqual(clientRuntimeProblems(d, [...REQUESTED_CAPABILITIES], 'https://bengoshi.itonami.app'), []);
  assert.equal(clientRuntimeConnectSrc(d, [...REQUESTED_CAPABILITIES], [], 'https://bengoshi.itonami.app'), "connect-src 'none'");
});

test('inquiry.send operates strictly offline (zero server relay) and fails closed if requireLiveRelay is requested', async () => {
  const engine = createOperationsEngine({ now: () => NOW });
  const secretText = '秘密の相談内容_SECRET_999';
  const draft = {
    lawyerId: 'syn-lawyer-990001',
    category: 'money',
    clientName: '相談者A',
    clientContact: 'a@example.invalid',
    counterpartyName: '相手方B',
    summary: secretText,
    evidenceManifest: [],
  };

  await assert.rejects(
    () => engine.execute('inquiry.send', { draft, requireLiveRelay: true }),
    /relay-disabled-method-a-only/,
  );

  const res = await engine.execute('inquiry.send', { draft });
  assert.equal(res.serverRelayUsed, false);
  assert.equal(res.record.relayStatus, 'offline_local_preview_only');
  assert.equal(verifyEnvelopeHasNoPlaintext(res.record.envelope, [secretText]).ok, true);
});

test('inference.assist is structurally removed and rejected at the operation layer', async () => {
  const engine = createOperationsEngine({ now: () => NOW });
  await assert.rejects(
    () => engine.execute('inference.assist', { rawText: 'メモを整理したい' }),
    /operation-prohibited-by-invariant/,
  );
});

test('Soudan -> Bengoshi URL query firewall ignores and rejects consultation text/tags in URL query parameters', () => {
  const r1 = sanitizeEntryLocation('?summary=%E7%9B%B8%E8%AB%87&tags=work&category=work', '#/search');
  assert.equal(r1.rejected, true);
  assert.deepEqual([...r1.rejectedParams], ['summary', 'tags', 'category']);
  assert.equal(r1.cleanHash, '#/search');

  const r2 = sanitizeEntryLocation('', '#/contact/compose?memo=secret&wish=refund');
  assert.equal(r2.rejected, true);
  assert.deepEqual([...r2.rejectedParams], ['memo', 'wish']);
  assert.equal(r2.cleanHash, '#/contact/compose');

  const clean = sanitizeEntryLocation('', '#/guide');
  assert.equal(clean.rejected, false);
  assert.equal(clean.cleanHash, '#/guide');
});
