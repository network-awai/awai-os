import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ZERO_FEE_POLICY,
  NEUTRAL_SORTS,
  validateLawyerRecord,
  validateSortMode,
  filterAndSortLawyers,
  exportArt11Record,
} from '../src/model.js';
import { SYNTHETIC_CATALOG_BUNDLE } from '../src/fixtures.js';
import { createOperationsEngine, PROHIBITED_OPERATIONS } from '../src/operations.js';

const NOW = '2026-11-27T09:00:00Z';

test('O2 zero-fee policy is fixed to none (fee_jpy: 0) with zero monetization, scout, or online retainer paths', () => {
  assert.equal(ZERO_FEE_POLICY.model, 'none');
  assert.equal(ZERO_FEE_POLICY.fee_jpy, 0);
  assert.equal(ZERO_FEE_POLICY.freeForUsers, true);
  assert.equal(ZERO_FEE_POLICY.freeForLawyers, true);
  assert.equal(ZERO_FEE_POLICY.referralFee, false);
  assert.equal(ZERO_FEE_POLICY.feeSplitting, false);
  assert.equal(ZERO_FEE_POLICY.ads, false);
  assert.equal(ZERO_FEE_POLICY.sponsoredPlacement, false);
  assert.equal(ZERO_FEE_POLICY.paidTier, false);
  assert.equal(ZERO_FEE_POLICY.tokenIntegration, false);
  assert.equal(ZERO_FEE_POLICY.scoutOrReverseOffer, false);
  assert.equal(ZERO_FEE_POLICY.onlineRetainerSigning, false);
});

test('all synthetic fixture lawyers pass strict O9 factual validation and use synthetic: true + .invalid domains', () => {
  for (const lawyer of SYNTHETIC_CATALOG_BUNDLE.lawyers) {
    assert.equal(lawyer.synthetic, true);
    assert.ok(lawyer.website_url.includes('.invalid'));
    assert.ok(lawyer.email.endsWith('.invalid'));
    assert.deepEqual(validateLawyerRecord(lawyer), [], `Fixture ${lawyer.id} must be valid`);
  }
});

test('expanded O9 validator rejects ALL mandatory forbidden terms (specialist, comparative, guarantee, matching/referral, reviews, scout, retainer)', () => {
  const base = SYNTHETIC_CATALOG_BUNDLE.lawyers[0];
  const mandatoryForbiddenTerms = [
    '専門',
    '専門家',
    '専門分野',
    'スペシャリスト',
    'プロ',
    'エキスパート',
    '勝訴率',
    '解決件数',
    'No.1',
    '日本一',
    'おすすめ',
    '人気順',
    'マッチ度',
    '必ず解決',
    'すぐ解決',
    'マッチング',
    '紹介',
    '口コミ',
    '★4.9',
    '☆5',
    'スカウト',
    '逆オファー',
    'オンライン委任契約',
  ];

  for (const term of mandatoryForbiddenTerms) {
    const candidate = { ...structuredClone(base), initial_consultation_fee_note: `テスト表記 ${term} テスト` };
    const probs = validateLawyerRecord(candidate);
    assert.ok(probs.length > 0, `Expanded O9 validator MUST reject "${term}"`);
  }

  for (const forbiddenField of [
    'reviews', 'star_rating', 'stars', 'win_rate', 'case_count', 'match_score',
    'popularity', 'ai_recommendation', 'sponsored', 'ad_slot', 'referral_fee',
    'fee_split', 'awai_token', 'response_speed', 'scout_enabled', 'reverse_offer', 'online_retainer',
  ]) {
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
  for (const badSort of ['rating_desc', 'win_rate_desc', 'response_speed_asc', 'ai_recommended', 'sponsored_first', 'case_count_desc', 'popularity_desc', 'match_score_desc']) {
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

test('lawyer.export_art11_record exports Art. 11 3-year preservation snapshot, edit history, and fee_jpy: 0', async () => {
  const engine = createOperationsEngine({ now: () => NOW });
  const edited = { ...structuredClone(SYNTHETIC_CATALOG_BUNDLE.lawyers[0]), initial_consultation_fee_note: '初回30分5,500円（税込）' };
  await engine.execute('lawyer.profile.update', { profile: edited, action: 'edit_fee_note' });

  const out = await engine.execute('lawyer.export_art11_record', {});
  assert.equal(out.localOnly, true);
  assert.equal(out.record.schema, 'bengoshi.art11.record.v1');
  assert.equal(out.record.retention_years, 3);
  assert.equal(out.record.exported_at, NOW);
  assert.equal(out.record.retain_until, '2029-11-27T09:00:00.000Z');
  assert.equal(out.record.free_participation_terms.fee_jpy, 0);
  assert.equal(out.record.free_participation_terms.model, 'none');
  assert.equal(out.record.listing_snapshot.name, edited.name);
  assert.equal(out.record.listing_snapshot.bar_association, edited.bar_association);
  assert.equal(out.record.edit_history.length, 1);
  assert.equal(out.record.edit_history[0].action, 'edit_fee_note');
  assert.match(out.record.snapshot_sha256, /^[0-9a-f]{64}$/);
  assert.match(out.record.record_sha256, /^[0-9a-f]{64}$/);

  // Direct pure helper check also works with empty history
  const direct = exportArt11Record(SYNTHETIC_CATALOG_BUNDLE.lawyers[1], [], { nowIso: NOW });
  assert.equal(direct.free_participation_terms.fee_jpy, 0);
  assert.equal(direct.edit_history.length, 1);
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

test('prohibited operations (inference.assist, fees, ads, ranking, reviews, scout, online retainer, firm-to-firm forwarding) are rejected', async () => {
  const engine = createOperationsEngine({ now: () => NOW });
  assert.ok(PROHIBITED_OPERATIONS.includes('inference.assist'));
  assert.ok(PROHIBITED_OPERATIONS.includes('scout.send'));
  assert.ok(PROHIBITED_OPERATIONS.includes('retainer.sign_online'));
  for (const op of PROHIBITED_OPERATIONS) {
    await assert.rejects(() => engine.execute(op, {}), /operation-prohibited-by-invariant/);
  }
});
