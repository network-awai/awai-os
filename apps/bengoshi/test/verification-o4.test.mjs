import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateVerificationStatus,
  canSendToLawyer,
  validateOnboardingSubmission,
  VERIFICATION_METHOD_A2,
} from '../src/model.js';
import { SYNTHETIC_CATALOG_BUNDLE } from '../src/fixtures.js';
import { createOperationsEngine } from '../src/operations.js';

const NOW = '2026-11-27T09:00:00Z';

function validDraftFor(lawyerId) {
  return {
    lawyerId,
    category: 'work',
    clientName: 'テスト相談者',
    clientContact: 'client@example.invalid',
    counterpartyName: '相手方株式会社',
    summary: '未払い賃金についての初回相談です。',
    evidenceHashes: [],
  };
}

test('O4 fixture bundle covers all 4 verification states accurately', () => {
  const statuses = new Set(
    SYNTHETIC_CATALOG_BUNDLE.lawyers.map(l => evaluateVerificationStatus(l.verification, NOW).effectiveStatus),
  );
  assert.deepEqual(statuses, new Set(['verified_manual_a2', 'unverified_self_declared', 'expired', 'suspended_or_revoked']));
});

test('O4 30-day TTL automatically transitions verified_manual_a2 to expired HARD hold after expires_at', () => {
  const activeLawyer = SYNTHETIC_CATALOG_BUNDLE.lawyers.find(l => l.registration_number === '990001');
  assert.equal(evaluateVerificationStatus(activeLawyer.verification, '2026-11-27T00:00:00Z').effectiveStatus, 'verified_manual_a2');
  assert.equal(evaluateVerificationStatus(activeLawyer.verification, '2026-11-27T00:00:00Z').hardHold, false);

  const afterExpiry = evaluateVerificationStatus(activeLawyer.verification, '2026-12-21T00:00:00Z');
  assert.equal(afterExpiry.effectiveStatus, 'expired');
  assert.equal(afterExpiry.hardHold, true);
  assert.equal(afterExpiry.liveSendAllowed, false);
  assert.equal(afterExpiry.demoSendAllowed, false);
});

test('O4 HARD hold blocks expired and suspended_or_revoked even when syntheticDemoMode is enabled', async () => {
  let brokerCalled = 0;
  const fakeBroker = { invoke: async () => { brokerCalled += 1; return { accepted: true }; } };
  const engine = createOperationsEngine({ broker: fakeBroker, now: () => NOW });

  for (const regNo of ['990005', '990006']) {
    const lawyer = SYNTHETIC_CATALOG_BUNDLE.lawyers.find(l => l.registration_number === regNo);
    const check = canSendToLawyer(lawyer, { syntheticDemoMode: true, nowIso: NOW });
    assert.equal(check.allowed, false);
    assert.equal(check.hardHold, true);

    await assert.rejects(
      () => engine.execute('inquiry.send', { draft: validDraftFor(lawyer.id), syntheticDemoMode: true }),
      /o4\.hard_hold_/,
    );
  }
  assert.equal(brokerCalled, 0, 'HARD hold must block before consent broker is ever reached');
});

test('O4 unverified_self_declared blocks live send and permits only explicit syntheticDemoMode dry-run', async () => {
  const unverified = SYNTHETIC_CATALOG_BUNDLE.lawyers.find(l => l.registration_number === '990004');
  let brokerCalled = 0;
  const fakeBroker = { invoke: async () => { brokerCalled += 1; return { accepted: true }; } };
  const engine = createOperationsEngine({ broker: fakeBroker, now: () => NOW });

  await assert.rejects(
    () => engine.execute('inquiry.send', { draft: validDraftFor(unverified.id), syntheticDemoMode: false }),
    /o4\.unverified_self_declared_blocks_live_send/,
  );
  assert.equal(brokerCalled, 0);

  const demoOut = await engine.execute('inquiry.send', { draft: validDraftFor(unverified.id), syntheticDemoMode: true, dryRun: true });
  assert.equal(brokerCalled, 1);
  assert.equal(demoOut.record.dryRun, true);
});

test('O4 onboarding validator rejects ID-photo-only verification and Nichibenren/Kanpo scraping', () => {
  const base = {
    name: '新規 弁護士',
    bar_association: '東京弁護士会',
    registration_number: '991234',
    office_name: '新規サンプル法律事務所',
    phone: '03-0000-9999',
    verification_method: VERIFICATION_METHOD_A2,
  };
  assert.deepEqual(validateOnboardingSubmission(base), []);

  for (const forbidden of ['id_photo', 'photo_only_verification', 'license_photo', 'scrape_nichibenren', 'scrape_kanpo']) {
    const probs = validateOnboardingSubmission({ ...base, [forbidden]: true });
    assert.ok(probs.some(p => p.code === 'o4.id_photo_or_scraping_prohibited'), `Must reject ${forbidden}`);
  }
});

test('qualification.verify_status reports zero scraping and zero ID-photo-only acceptance', async () => {
  const engine = createOperationsEngine({ now: () => NOW });
  const res = await engine.execute('qualification.verify_status', { lawyerId: 'syn-lawyer-990001' });
  assert.equal(res.scrapingUsed, false);
  assert.equal(res.idPhotoOnlyAccepted, false);
  assert.equal(res.verification.effectiveStatus, 'verified_manual_a2');
  assert.equal(res.sendGate.allowed, true);
});
