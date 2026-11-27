import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ZERO_FEE_POLICY,
  NEUTRAL_SORTS,
  validateLawyerRecord,
  validateSortMode,
  filterAndSortLawyers,
} from '../src/model.js';
import { SYNTHETIC_CATALOG_BUNDLE } from '../src/fixtures.js';
import { createOperationsEngine, PROHIBITED_OPERATIONS } from '../src/operations.js';

const NOW = '2026-11-27T09:00:00Z';

test('O2 zero-fee policy is fixed to none with zero monetization paths', () => {
  assert.equal(ZERO_FEE_POLICY.model, 'none');
  assert.equal(ZERO_FEE_POLICY.freeForUsers, true);
  assert.equal(ZERO_FEE_POLICY.freeForLawyers, true);
  assert.equal(ZERO_FEE_POLICY.referralFee, false);
  assert.equal(ZERO_FEE_POLICY.feeSplitting, false);
  assert.equal(ZERO_FEE_POLICY.ads, false);
  assert.equal(ZERO_FEE_POLICY.sponsoredPlacement, false);
  assert.equal(ZERO_FEE_POLICY.paidTier, false);
  assert.equal(ZERO_FEE_POLICY.tokenIntegration, false);
});

test('all synthetic fixture lawyers pass strict O9 factual validation', () => {
  for (const lawyer of SYNTHETIC_CATALOG_BUNDLE.lawyers) {
    assert.deepEqual(validateLawyerRecord(lawyer), [], `Fixture ${lawyer.id} must be valid`);
  }
});

test('O9 validator rejects 専門 / 専門家 per 日弁連 業務広告指針 第3-12', () => {
  for (const badArea of ['離婚専門', '労働問題専門家', 'Divorce Specialist']) {
    const candidate = { ...structuredClone(SYNTHETIC_CATALOG_BUNDLE.lawyers[0]), practice_areas: [badArea] };
    const probs = validateLawyerRecord(candidate);
    assert.ok(probs.some(p => p.code === 'o9.forbidden_specialist_claim'), `Must reject "${badArea}"`);
  }
});

test('O9 validator rejects win rates, case counts, comparative claims, reviews, ratings, and fees/ads', () => {
  const base = SYNTHETIC_CATALOG_BUNDLE.lawyers[0];
  const badTextSamples = [
    ['initial_consultation_fee_note', '勝訴率98%の実績'],
    ['initial_consultation_fee_note', '解決件数1000件以上'],
    ['office_name', '地域No.1実績豊富な法律事務所'],
    ['initial_consultation_fee_note', '口コミ評価★4.9'],
    ['initial_consultation_fee_note', '紹介料あり・スポンサー掲載プラン'],
  ];
  for (const [field, value] of badTextSamples) {
    const candidate = { ...structuredClone(base), [field]: value };
    const probs = validateLawyerRecord(candidate);
    assert.ok(probs.length > 0, `Must reject ${field}="${value}"`);
  }

  for (const forbiddenField of ['reviews', 'star_rating', 'win_rate', 'case_count', 'ai_recommendation', 'sponsored', 'ad_slot', 'referral_fee', 'fee_split', 'awai_token', 'response_speed']) {
    const candidate = { ...structuredClone(base), [forbiddenField]: 1 };
    const probs = validateLawyerRecord(candidate);
    assert.ok(probs.some(p => p.field === forbiddenField && p.code === 'o9.forbidden_field'), `Must reject forbidden field ${forbiddenField}`);
  }
});

test('O9 mandatory Art. 9 fields (name, bar_association) are enforced', () => {
  const base = structuredClone(SYNTHETIC_CATALOG_BUNDLE.lawyers[0]);
  assert.ok(validateLawyerRecord({ ...base, name: '' }).some(p => p.code === 'lawyer.name_required'));
  assert.ok(validateLawyerRecord({ ...base, bar_association: '' }).some(p => p.code === 'lawyer.bar_association_required'));
});

test('O9 neutral sorting only (kana_asc, reg_no_asc, prefecture_asc) and rejects non-neutral sorts', () => {
  assert.deepEqual(NEUTRAL_SORTS, ['kana_asc', 'reg_no_asc', 'prefecture_asc']);
  for (const badSort of ['rating_desc', 'win_rate_desc', 'response_speed_asc', 'ai_recommended', 'sponsored_first', 'case_count_desc']) {
    assert.equal(validateSortMode(badSort).ok, false);
    assert.throws(() => filterAndSortLawyers(SYNTHETIC_CATALOG_BUNDLE.lawyers, { sort: badSort, directoryScope: 'neutral_cross_firm', nowIso: NOW }), /non_neutral_sort_rejected/);
  }

  const activeOnly = { verificationStatus: 'verified_manual_a2', directoryScope: 'neutral_cross_firm', nowIso: NOW };
  const byKana = filterAndSortLawyers(SYNTHETIC_CATALOG_BUNDLE.lawyers, { ...activeOnly, sort: 'kana_asc' }).map(l => l.registration_number);
  const byReg = filterAndSortLawyers(SYNTHETIC_CATALOG_BUNDLE.lawyers, { ...activeOnly, sort: 'reg_no_asc' }).map(l => l.registration_number);
  const byPref = filterAndSortLawyers(SYNTHETIC_CATALOG_BUNDLE.lawyers, { ...activeOnly, sort: 'prefecture_asc' }).map(l => l.registration_number);

  assert.deepEqual(byKana, ['990002', '990001', '990003']);
  assert.deepEqual(byReg, ['990001', '990002', '990003']);
  assert.deepEqual(byPref, ['990003', '990002', '990001']);
});

test('directory_scope switches cleanly between tenant_only and neutral_cross_firm', async () => {
  const engine = createOperationsEngine({ now: () => NOW });
  const tenantRes = await engine.execute('directory.search', { directoryScope: 'tenant_only' });
  const crossRes = await engine.execute('directory.search', { directoryScope: 'neutral_cross_firm' });
  assert.equal(tenantRes.total, 5);
  assert.equal(crossRes.total, 6);
  assert.ok(!tenantRes.lawyers.some(l => l.registration_number === '990003'));
  assert.ok(crossRes.lawyers.some(l => l.registration_number === '990003'));
});

test('prohibited O2/O8/O9 operations (fees, ads, ranking, reviews, firm-to-firm forwarding) are rejected at operation layer', async () => {
  const engine = createOperationsEngine({ now: () => NOW });
  for (const op of PROHIBITED_OPERATIONS) {
    await assert.rejects(() => engine.execute(op, {}), /operation-prohibited-by-invariant/);
  }
});
