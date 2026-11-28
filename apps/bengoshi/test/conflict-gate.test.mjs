import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLawyerKeyPair } from '../src/crypto.js';
import { buildSyntheticQaIntakeRecords, SYNTHETIC_CATALOG_BUNDLE } from '../src/fixtures.js';
import { createInitialLocalState, createOperationsEngine } from '../src/operations.js';
import { verifyAuditChain } from '../src/model.js';

const NOW = '2026-11-27T09:00:00Z';

function createSerialQueue() {
  let tail = Promise.resolve();
  return function enqueue(fn) {
    const next = tail.then(fn, fn);
    tail = next.then(() => {}, () => {});
    return next;
  };
}

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

// ---- Kougi P1 TOCTOU regressions: check-and-act inside the EXACT SAME serialized queue & rebase boundary ----

test('TOCTOU Test A1 (intake.decide accept): intervening queued write invalidating conflict confirmation blocks accept inside the queue', async () => {
  const kp = await generateLawyerKeyPair();
  const state = createInitialLocalState();
  state.intakeRecords = await buildSyntheticQaIntakeRecords('syn-lawyer-990001', kp.publicKeyJwk);

  const enqueueWrite = createSerialQueue();
  let holdNextPersist = false;
  let releaseHeldPersist = null;
  let persistStarted = null;
  let rev = 0;

  const engine = createOperationsEngine({
    state,
    getPrivateKeyJwk: async () => kp.privateKeyJwk,
    now: () => NOW,
    enqueueWrite,
    onStateChange: async () => {
      if (holdNextPersist) {
        holdNextPersist = false;
        if (persistStarted) persistStarted();
        await new Promise(resolve => { releaseHeldPersist = resolve; });
      }
      rev += 1;
      return { ok: true, revision: rev };
    },
  });

  // Start with a confirmed clear conflict check
  const confirmed = await engine.execute('intake.conflict_check', { inquiryId: 'inq-qa-clear-001', confirmClear: true });
  assert.equal(confirmed.revealGate.allowed, true);

  // Start an intervening write that revokes lawyer confirmation (held inside the queue before commit)
  holdNextPersist = true;
  const startedPromise = new Promise(resolve => { persistStarted = resolve; });
  const invalidateOp = engine.execute('intake.conflict_check', { inquiryId: 'inq-qa-clear-001', confirmClear: false });
  await startedPromise;
  assert.equal(state.intakeRecords[0].conflictCheck.confirmedByLawyer, true, 'Pre-queue state still looks confirmed while write #1 is in flight');

  // Queue intake.decide("accept") BEHIND the invalidation write while pre-queue state still looks clear & confirmed
  const acceptOp = engine.execute('intake.decide', {
    inquiryId: 'inq-qa-clear-001',
    action: 'accept',
    replyText: '受任予定（TOCTOU遮断テスト）',
  });

  // Release the intervening write
  releaseHeldPersist();
  await invalidateOp;

  // Queued accept MUST HARD-BLOCK inside the queue
  await assert.rejects(
    acceptOp,
    err => err.code === 'conflict_gate.lawyer_confirmation_required' && err.hardGate === true && err.blocked === true,
  );

  // Decision must NOT be committed and NO false accept audit entry may exist
  const rec = state.intakeRecords.find(r => r.inquiryId === 'inq-qa-clear-001');
  assert.equal(rec.decision, null, 'Decision must NOT be mutated to accept');
  assert.equal(rec.replySentAt, null);
  assert.equal(
    state.auditLog.some(e => e.operation === 'intake.decide' && e.outcome === 'accept'),
    false,
    'No false accept audit entry may be written',
  );
  assert.ok(
    state.auditLog.some(e => e.operation === 'intake.decide' && e.outcome === 'blocked'),
    'Blocked audit entry must be recorded',
  );
  assert.equal(verifyAuditChain(state.auditLog).ok, true);
});

test('TOCTOU Test A2 (intake.decide accept): intervening queued conflictLedger addition blocks accept inside the queue even when stored conflictCheck was clear', async () => {
  const kp = await generateLawyerKeyPair();
  const state = createInitialLocalState();
  state.intakeRecords = await buildSyntheticQaIntakeRecords('syn-lawyer-990001', kp.publicKeyJwk);

  const enqueueWrite = createSerialQueue();
  let releaseLedgerWrite = null;
  let ledgerWriteStarted = null;
  let rev = 0;

  const engine = createOperationsEngine({
    state,
    getPrivateKeyJwk: async () => kp.privateKeyJwk,
    now: () => NOW,
    enqueueWrite,
    onStateChange: async () => {
      rev += 1;
      return { ok: true, revision: rev };
    },
  });

  await engine.execute('intake.conflict_check', { inquiryId: 'inq-qa-clear-001', confirmClear: true });

  // Queue an intervening ledger addition on the SAME per-store write queue (mirrors mutateAndPersist in app.js)
  const startedPromise = new Promise(resolve => { ledgerWriteStarted = resolve; });
  const ledgerAddOp = enqueueWrite(async () => {
    ledgerWriteStarted();
    await new Promise(resolve => { releaseLedgerWrite = resolve; });
    state.conflictLedger.push({
      id: 'ledger-toctou-001',
      partyName: '無関係建設株式会社',
      role: 'existing_client',
      matterRef: '2026-C-TOCTOU',
    });
  });
  await startedPromise;

  // Queue accept while pre-queue state still looks completely clear
  const acceptOp = engine.execute('intake.decide', {
    inquiryId: 'inq-qa-clear-001',
    action: 'accept',
    replyText: '受任（台帳追加TOCTOU遮断）',
  });

  releaseLedgerWrite();
  await ledgerAddOp;

  await assert.rejects(
    acceptOp,
    err => err.code === 'conflict_gate.conflict_detected_hard_block' && err.hardGate === true && err.blocked === true && err.ledgerConflict === true,
  );

  const rec = state.intakeRecords.find(r => r.inquiryId === 'inq-qa-clear-001');
  assert.equal(rec.decision, null);
  assert.equal(state.auditLog.some(e => e.operation === 'intake.decide' && e.outcome === 'accept'), false);
  assert.equal(verifyAuditChain(state.auditLog).ok, true);
});

test('TOCTOU Test B (body reveal): intervening queued write changing conflict state to unconfirmed or conflicted blocks body reveal without decrypting or returning plaintext', async () => {
  for (const mode of ['unconfirm', 'ledger_conflict', 'status_conflict']) {
    const kp = await generateLawyerKeyPair();
    const state = createInitialLocalState();
    state.intakeRecords = await buildSyntheticQaIntakeRecords('syn-lawyer-990001', kp.publicKeyJwk);

    const enqueueWrite = createSerialQueue();
    let releaseIntervening = null;
    let interveningStarted = null;
    let privateKeyReads = 0;
    let rev = 0;

    const engine = createOperationsEngine({
      state,
      getPrivateKeyJwk: async () => {
        privateKeyReads += 1;
        return kp.privateKeyJwk;
      },
      now: () => NOW,
      enqueueWrite,
      onStateChange: async () => {
        rev += 1;
        return { ok: true, revision: rev };
      },
    });

    await engine.execute('intake.conflict_check', { inquiryId: 'inq-qa-clear-001', confirmClear: true });

    const startedPromise = new Promise(resolve => { interveningStarted = resolve; });
    const interveningOp = enqueueWrite(async () => {
      interveningStarted();
      await new Promise(resolve => { releaseIntervening = resolve; });
      const rec = state.intakeRecords.find(r => r.inquiryId === 'inq-qa-clear-001');
      if (mode === 'unconfirm') {
        rec.conflictCheck = { ...rec.conflictCheck, confirmedByLawyer: false, confirmedAt: null };
      } else if (mode === 'ledger_conflict') {
        state.conflictLedger.push({
          id: 'ledger-reveal-toctou',
          partyName: '無関係建設株式会社',
          role: 'adverse_party',
          matterRef: '2026-L-TOCTOU',
        });
      } else {
        rec.conflictCheck = { ...rec.conflictCheck, result: 'conflict_detected', confirmedByLawyer: false };
      }
    });
    await startedPromise;

    // Queue body reveal behind the intervening conflict-state mutation
    let resolvedPayload = null;
    const revealOp = engine.execute('intake.decide', { inquiryId: 'inq-qa-clear-001', action: 'reveal' })
      .then(res => { resolvedPayload = res; return res; });

    releaseIntervening();
    await interveningOp;

    const expectedCode = mode === 'unconfirm'
      ? 'conflict_gate.lawyer_confirmation_required'
      : 'conflict_gate.conflict_detected_hard_block';

    await assert.rejects(
      revealOp,
      err => err.code === expectedCode && err.hardGate === true && err.blocked === true,
    );

    assert.equal(resolvedPayload, null, `[${mode}] Must return ZERO plaintext body`);
    assert.equal(privateKeyReads, 0, `[${mode}] Must NOT read private key or attempt decryption when blocked in queue`);
    assert.equal(state.auditLog.some(e => e.operation === 'intake.decide' && e.outcome === 'revealed'), false);
    assert.ok(state.auditLog.some(e => e.operation === 'intake.decide' && e.outcome === 'blocked'));
    assert.equal(verifyAuditChain(state.auditLog).ok, true);
  }
});

test('TOCTOU Test C (cross-tab / storage rebase): state-conflict refresh invalidating conflict check or adding ledger conflict blocks both reveal and accept inside rebase', async () => {
  for (const action of ['reveal', 'accept']) {
    for (const conflictMutation of ['unconfirmed', 'conflict_detected', 'ledger_added']) {
      const kp = await generateLawyerKeyPair();
      const state = createInitialLocalState();
      state.intakeRecords = await buildSyntheticQaIntakeRecords('syn-lawyer-990001', kp.publicKeyJwk);

      const enqueueWrite = createSerialQueue();
      let persistedRev = 0;
      let persistedState = null;

      const engine = createOperationsEngine({
        state,
        getPrivateKeyJwk: async () => kp.privateKeyJwk,
        now: () => NOW,
        enqueueWrite,
        onStateChange: async (candidate) => {
          if (persistedRev === 1) {
            // Simulate Tab B committing revision 2 before Tab A's commit
            const tabBState = structuredClone(persistedState);
            const tabBRec = tabBState.intakeRecords.find(r => r.inquiryId === 'inq-qa-clear-001');
            if (conflictMutation === 'unconfirmed') {
              tabBRec.conflictCheck = { ...tabBRec.conflictCheck, confirmedByLawyer: false, confirmedAt: null };
            } else if (conflictMutation === 'conflict_detected') {
              tabBRec.conflictCheck = { ...tabBRec.conflictCheck, result: 'conflict_detected', confirmedByLawyer: false };
            } else {
              tabBState.conflictLedger.push({
                id: 'ledger-tab-b',
                partyName: '無関係建設株式会社',
                role: 'existing_client',
                matterRef: 'TabB-2026',
              });
            }
            persistedRev = 2;
            persistedState = structuredClone(tabBState);
            return {
              ok: false,
              code: 'state-conflict',
              message: 'state-conflict',
              refreshed: true,
              previousRevision: 1,
              latestRevision: 2,
              refreshedState: structuredClone(tabBState),
            };
          }
          persistedRev += 1;
          persistedState = structuredClone(candidate);
          return { ok: true, revision: persistedRev };
        },
      });

      // Revision 1: Tab A confirms clear conflict check
      await engine.execute('intake.conflict_check', { inquiryId: 'inq-qa-clear-001', confirmClear: true });
      assert.equal(persistedRev, 1);

      // Tab A now attempts reveal or accept while Tab B has invalidated conflict status in revision 2
      let returned = null;
      const expectedCode = conflictMutation === 'unconfirmed'
        ? 'conflict_gate.lawyer_confirmation_required'
        : 'conflict_gate.conflict_detected_hard_block';

      await assert.rejects(
        () => engine.execute('intake.decide', {
          inquiryId: 'inq-qa-clear-001',
          action,
          replyText: '受任（リベース遮断テスト）',
        }).then(r => { returned = r; return r; }),
        err => err.code === expectedCode && err.hardGate === true && err.blocked === true,
      );

      assert.equal(returned, null, `[${action}/${conflictMutation}] Must return no plaintext or acceptance result`);
      const recMem = state.intakeRecords.find(r => r.inquiryId === 'inq-qa-clear-001');
      const recDisk = persistedState.intakeRecords.find(r => r.inquiryId === 'inq-qa-clear-001');
      assert.equal(recMem.decision, null, `[${action}/${conflictMutation}] In-memory decision must remain null`);
      assert.equal(recDisk.decision, null, `[${action}/${conflictMutation}] Persisted decision must remain null`);
      assert.equal(persistedState.auditLog.some(e => e.operation === 'intake.decide' && (e.outcome === 'accept' || e.outcome === 'revealed')), false);
      assert.ok(persistedState.auditLog.some(e => e.operation === 'intake.decide' && e.outcome === 'blocked'));
      assert.equal(verifyAuditChain(persistedState.auditLog).ok, true);
    }
  }
});

test('TOCTOU Test D (O4 HARD hold in inquiry.send): intervening queued lawyer status change to suspended_or_revoked blocks inquiry.send inside the queue', async () => {
  const state = createInitialLocalState();
  const baseLawyer = structuredClone(SYNTHETIC_CATALOG_BUNDLE.lawyers[0]);
  state.lawyerProfile = structuredClone(baseLawyer);

  const enqueueWrite = createSerialQueue();
  let holdNextPersist = false;
  let releaseHeldPersist = null;
  let persistStarted = null;
  let rev = 0;

  const engine = createOperationsEngine({
    state,
    now: () => NOW,
    enqueueWrite,
    onStateChange: async () => {
      if (holdNextPersist) {
        holdNextPersist = false;
        if (persistStarted) persistStarted();
        await new Promise(resolve => { releaseHeldPersist = resolve; });
      }
      rev += 1;
      return { ok: true, revision: rev };
    },
  });

  // Queue an intervening profile update transitioning lawyer to suspended_or_revoked
  const revokedProfile = structuredClone(baseLawyer);
  revokedProfile.verification = {
    ...revokedProfile.verification,
    status: 'suspended_or_revoked',
  };
  holdNextPersist = true;
  const startedPromise = new Promise(resolve => { persistStarted = resolve; });
  const revokeOp = engine.execute('lawyer.profile.update', { profile: revokedProfile, action: 'status_revoke' });
  await startedPromise;

  // Queue inquiry.send while pre-queue state still shows verified_manual_a2
  const sendOp = engine.execute('inquiry.send', {
    draft: {
      lawyerId: baseLawyer.id,
      category: 'work',
      clientName: 'テスト相談者',
      clientContact: 'client@example.invalid',
      counterpartyName: '相手方株式会社',
      summary: 'O4キュー内再検査テスト',
      evidenceManifest: [],
    },
  });

  releaseHeldPersist();
  await revokeOp;

  await assert.rejects(
    sendOp,
    err => err.code === 'o4.hard_hold_suspended_or_revoked' && err.hardHold === true,
  );
  assert.equal(state.sentInquiries.length, 0);
  assert.ok(state.auditLog.some(e => e.operation === 'inquiry.send' && e.outcome === 'blocked'));
  assert.equal(verifyAuditChain(state.auditLog).ok, true);
});
