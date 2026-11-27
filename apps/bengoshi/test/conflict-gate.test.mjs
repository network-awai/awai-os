import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLawyerKeyPair } from '../src/crypto.js';
import { buildSyntheticQaIntakeRecords } from '../src/fixtures.js';
import { createInitialLocalState, createOperationsEngine } from '../src/operations.js';

const NOW = '2026-11-27T09:00:00Z';

test('AWAI-3235 intake.list exposes ONLY minimal conflict-check headers, never plaintext body', async () => {
  const kp = await generateLawyerKeyPair();
  const state = createInitialLocalState();
  state.intakeRecords = await buildSyntheticQaIntakeRecords('syn-lawyer-990001', kp.publicKeyJwk);

  const engine = createOperationsEngine({ state, getPrivateKeyJwk: async () => kp.privateKeyJwk, now: () => NOW });
  const listed = await engine.execute('intake.list');

  assert.equal(listed.items.length, 2);
  const serialized = JSON.stringify(listed);
  assert.ok(!serialized.includes('未払い残業代'), 'Clear inquiry body must not appear in intake.list');
  assert.ok(!serialized.includes('機密本文'), 'Conflicting inquiry body must not appear in intake.list');
  assert.equal(listed.items[0].revealGate.allowed, false);
  assert.equal(listed.items[1].revealGate.allowed, false);
});

test('AWAI-3235 conflicting counterparty HARD-blocks body decryption even if confirmClear is attempted', async () => {
  const kp = await generateLawyerKeyPair();
  const state = createInitialLocalState();
  state.intakeRecords = await buildSyntheticQaIntakeRecords('syn-lawyer-990001', kp.publicKeyJwk);

  const engine = createOperationsEngine({ state, getPrivateKeyJwk: async () => kp.privateKeyJwk, now: () => NOW });

  // Attempt reveal before conflict check -> blocked
  await assert.rejects(() => engine.execute('intake.decide', { inquiryId: 'inq-qa-conflict-002', action: 'reveal' }), /conflict_gate\.check_required/);

  // Run conflict check against ledger containing サンプル商事株式会社
  const cc = await engine.execute('intake.conflict_check', { inquiryId: 'inq-qa-conflict-002', confirmClear: true });
  assert.equal(cc.conflictCheck.result, 'conflict_detected');
  assert.equal(cc.conflictCheck.confirmedByLawyer, false);
  assert.ok(cc.conflictCheck.matches.length >= 1);
  assert.equal(cc.revealGate.allowed, false);

  // Body decryption/reveal is HARD-blocked
  await assert.rejects(
    () => engine.execute('intake.decide', { inquiryId: 'inq-qa-conflict-002', action: 'reveal' }),
    /conflict_gate\.conflict_detected_hard_block/,
  );

  // Declining due to conflict works without revealing body
  const dec = await engine.execute('intake.decide', { inquiryId: 'inq-qa-conflict-002', action: 'decline_conflict' });
  assert.equal(dec.revealed, false);
  assert.equal(dec.decision.status, 'declined_conflict');
});

test('AWAI-3235 clear conflict check requires explicit lawyer confirmation before decrypting body', async () => {
  const kp = await generateLawyerKeyPair();
  const state = createInitialLocalState();
  state.intakeRecords = await buildSyntheticQaIntakeRecords('syn-lawyer-990001', kp.publicKeyJwk);

  const engine = createOperationsEngine({ state, getPrivateKeyJwk: async () => kp.privateKeyJwk, now: () => NOW });

  // Step 1: check without confirmation -> still blocked
  const ccUnconfirmed = await engine.execute('intake.conflict_check', { inquiryId: 'inq-qa-clear-001', confirmClear: false });
  assert.equal(ccUnconfirmed.conflictCheck.result, 'clear');
  assert.equal(ccUnconfirmed.revealGate.allowed, false);
  await assert.rejects(
    () => engine.execute('intake.decide', { inquiryId: 'inq-qa-clear-001', action: 'reveal' }),
    /conflict_gate\.lawyer_confirmation_required/,
  );

  // Step 2: lawyer confirms clear receipt -> decrypts on device
  const ccConfirmed = await engine.execute('intake.conflict_check', { inquiryId: 'inq-qa-clear-001', confirmClear: true });
  assert.equal(ccConfirmed.revealGate.allowed, true);
  assert.match(ccConfirmed.conflictCheck.receiptDigest, /^[0-9a-f]{64}$/);

  const revealed = await engine.execute('intake.decide', { inquiryId: 'inq-qa-clear-001', action: 'reveal' });
  assert.equal(revealed.revealed, true);
  assert.match(revealed.plaintext.summary, /未払い残業代/);
});

test('O8 firm-to-firm forwarding is rejected in intake.decide', async () => {
  const kp = await generateLawyerKeyPair();
  const state = createInitialLocalState();
  state.intakeRecords = await buildSyntheticQaIntakeRecords('syn-lawyer-990001', kp.publicKeyJwk);
  const engine = createOperationsEngine({ state, now: () => NOW });

  await assert.rejects(
    () => engine.execute('intake.decide', { inquiryId: 'inq-qa-clear-001', action: 'forward_to_firm', forwardToFirmId: 'other-firm' }),
    /o8\.firm_to_firm_forwarding_prohibited/,
  );
});
