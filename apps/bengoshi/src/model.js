// Bengoshi domain model, structural invariants (O2, O4, O8, O9, AWAI-3235, Art. 11),
// Method A 7-line manual Copy Contact, Soudan interchange (soudan.memo.export.v1),
// Soudan -> Bengoshi URL query firewall, and lawyer card export (bengoshi.lawyer.card.v1).

import { NICHIBENREN_SEARCH_URL } from './legal-notices.js';

export const ZERO_FEE_POLICY = Object.freeze({
  model: 'none',
  fee_jpy: 0,
  freeForUsers: true,
  freeForLawyers: true,
  referralFee: false,
  feeSplitting: false,
  ads: false,
  sponsoredPlacement: false,
  paidTier: false,
  tokenIntegration: false,
  scoutOrReverseOffer: false,
  onlineRetainerSigning: false,
});

export const NEUTRAL_SORTS = Object.freeze(['kana_asc', 'reg_no_asc', 'prefecture_asc']);
export const DIRECTORY_SCOPES = Object.freeze(['tenant_only', 'neutral_cross_firm']);
export const VERIFICATION_STATUSES = Object.freeze([
  'unverified_self_declared',
  'verified_manual_a2',
  'expired',
  'suspended_or_revoked',
]);
export const VERIFICATION_TTL_DAYS = 30;
export const VERIFICATION_METHOD_A2 = 'manual_nichibenren_and_office_contact';
export const ART11_RETENTION_YEARS = 3;
export const SOUDAN_TEMPLATE_ID = 'consultation-memo.jpn.v1';

export const INQUIRY_CATEGORIES = Object.freeze([
  'money',
  'contract',
  'work',
  'family',
  'housing',
  'traffic',
  'consumer',
  'inheritance',
  'corporate',
  'other',
]);

// Factual practice areas ONLY — strictly free of prohibited specialist/promotional wording per 日弁連 業務広告指針 第3-12.
export const PRACTICE_AREAS = Object.freeze([
  '民事一般',
  '家事・相続',
  '労働',
  '不動産・建築',
  '債務整理',
  '交通事故',
  '消費者問題',
  '企業法務・契約',
  '知的財産',
  '刑事弁護',
  'インターネット関係',
  '行政事件',
]);

export const PREFECTURES = Object.freeze([
  ['01', '北海道'], ['02', '青森県'], ['03', '岩手県'], ['04', '宮城県'], ['05', '秋田県'],
  ['06', '山形県'], ['07', '福島県'], ['08', '茨城県'], ['09', '栃木県'], ['10', '群馬県'],
  ['11', '埼玉県'], ['12', '千葉県'], ['13', '東京都'], ['14', '神奈川県'], ['15', '新潟県'],
  ['16', '富山県'], ['17', '石川県'], ['18', '福井県'], ['19', '山梨県'], ['20', '長野県'],
  ['21', '岐阜県'], ['22', '静岡県'], ['23', '愛知県'], ['24', '三重県'], ['25', '滋賀県'],
  ['26', '京都府'], ['27', '大阪府'], ['28', '兵庫県'], ['29', '奈良県'], ['30', '和歌山県'],
  ['31', '鳥取県'], ['32', '島根県'], ['33', '岡山県'], ['34', '広島県'], ['35', '山口県'],
  ['36', '徳島県'], ['37', '香川県'], ['38', '愛媛県'], ['39', '高知県'], ['40', '福岡県'],
  ['41', '佐賀県'], ['42', '長崎県'], ['43', '熊本県'], ['44', '大分県'], ['45', '宮崎県'],
  ['46', '鹿児島県'], ['47', '沖縄県'],
]);

export const PREFECTURE_MAP = Object.freeze(Object.fromEntries(PREFECTURES));

export const ALLOWED_LAWYER_FACTUAL_FIELDS = Object.freeze([
  'id',
  'synthetic',
  'tenant_id',
  'name',
  'name_kana',
  'bar_association',
  'registration_number',
  'office_name',
  'prefecture_code',
  'address',
  'phone',
  'fax',
  'email',
  'website_url',
  'practice_areas',
  'career_facts',
  'languages',
  'legal_aid_houterasu',
  'initial_consultation_fee_note',
  'nichibenren_search_url',
  'verification',
  'e2ee_public_key_jwk',
  'e2ee_key_fingerprint',
]);

// Fields strictly prohibited under O2 (zero-fee) and O9 (strict neutrality / anti-scout / no online retainer).
export const FORBIDDEN_LAWYER_FIELDS = Object.freeze([
  'reviews',
  'review_count',
  'rating',
  'star_rating',
  'stars',
  'win_rate',
  'case_count',
  'resolved_cases',
  'rank',
  'ranking',
  'score',
  'match_score',
  'popularity',
  'ai_recommendation',
  'recommended',
  'response_speed',
  'response_speed_rank',
  'sponsored',
  'ad_slot',
  'ad_tier',
  'referral_fee',
  'fee_split',
  'commission_rate',
  'paid_tier',
  'subscription_plan',
  'awai_token',
  'reward_points',
  'scout_enabled',
  'reverse_offer',
  'online_retainer',
]);

// Expanded O9 validator patterns per 日弁連 業務広告規程 会規44号・指針第3-12 & Legal Addendum:
// Rejects ALL of: 専門, 専門家, 専門分野, スペシャリスト, プロ, エキスパート, 勝訴率, 解決件数,
// No.1, 日本一, おすすめ, 人気順, マッチ度, 必ず解決, すぐ解決, マッチング, 紹介, reviews/stars,
// scout/reverse-offer, online retainer signing, and fee/ad claims.
export const FORBIDDEN_O9_PATTERNS = Object.freeze([
  { code: 'o9.forbidden_specialist_claim', pattern: /専門分野|専門家|専門(?!校|職大学院)|スペシャリスト|エキスパート|プロ(?!フィール|グラム|ジェクト|トコル)/u },
  { code: 'o9.forbidden_specialist_claim', pattern: /\bspecialist\b|\bexpert\b|\bpro\b|\bcertified\s+expert\b/i },
  { code: 'o9.forbidden_win_rate', pattern: /勝訴率|勝率|成功確率|win\s*rate/i },
  { code: 'o9.forbidden_case_count', pattern: /解決件数|解決実績\s*\d|受任件数|相談実績\s*\d|cases?\s+won/i },
  { code: 'o9.forbidden_comparative_claim', pattern: /No\.?\s*1|ナンバーワン|日本一|地域一番|業界トップ|実績豊富|圧倒的|最強|最高水準|おすすめ|人気順|マッチ度|ランキング/iu },
  { code: 'o9.forbidden_result_guarantee', pattern: /必ず解決|すぐ解決|必ず勝てる|100%解決|確実解決/u },
  { code: 'o9.forbidden_matching_or_referral', pattern: /マッチング|紹介|lawyer[- ]matching/iu },
  { code: 'o9.forbidden_review_or_rating', pattern: /口コミ|★|☆|星評価|レビュー|\bstar\s*rating\b|\breviews?\b/i },
  { code: 'o9.forbidden_scout_or_retainer', pattern: /スカウト|逆オファー|オンライン委任契約|電子委任契約締結|\bscout\b|\breverse[- ]offer\b/i },
  { code: 'o2.forbidden_fee_or_ad', pattern: /報酬分配|広告枠|スポンサー掲載|有料プラン|ポイント付与|トークン報酬|referral\s*fee|sponsored\s*placement/i },
]);

export const FORBIDDEN_ONBOARDING_FIELDS = Object.freeze([
  'id_photo',
  'id_photo_b64',
  'id_photo_url',
  'photo_only_verification',
  'license_photo',
  'scrape_nichibenren',
  'scrape_kanpo',
]);

// URL query parameter names carrying consultation text or tags (Soudan -> Bengoshi firewall)
export const BLOCKED_QUERY_PARAM_KEYS = Object.freeze([
  'summary',
  'memo',
  'text',
  'body',
  'consultation',
  'consult',
  'draft',
  'category',
  'tag',
  'tags',
  'wish',
  'deadline',
  'client',
  'clientName',
  'client_name',
  'counterparty',
  'otherParty',
  'other_party',
  'evidence',
  'evidence_manifest',
  'q',
  'query',
  'soudan',
]);

// ---- Dependency-free SHA-256 ----
const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

export function sha256Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  if (!(bytes instanceof Uint8Array)) throw new TypeError('bytes-or-string-required');
  const l = bytes.length;
  const bitLen = l * 8;
  const withPad = (((l + 8) >> 6) + 1) * 64;
  const msg = new Uint8Array(withPad);
  msg.set(bytes);
  msg[l] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(withPad - 4, bitLen >>> 0);
  dv.setUint32(withPad - 8, Math.floor(bitLen / 0x100000000));
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < withPad; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

// ---- Soudan -> Bengoshi URL Query Firewall ----
// Rejects/ignores any URL query parameters carrying consultation text, tags, or draft fields.
// Only allows clean hash routes (`#/...`) without query payload injection.
export function sanitizeEntryLocation(search = '', hash = '') {
  const rejectedParams = [];
  const checkSearchParams = (raw) => {
    if (!raw) return;
    const qs = raw.startsWith('?') ? raw.slice(1) : raw;
    if (!qs) return;
    const params = new URLSearchParams(qs);
    for (const key of params.keys()) {
      const lower = key.toLowerCase();
      // Only allow MCP embed explicit parentOrigin/sessionToken when on #/embed/mcp
      const isEmbedRoute = String(hash || '').split('?')[0] === '#/embed/mcp';
      if (isEmbedRoute && (key === 'parentOrigin' || key === 'sessionToken')) continue;
      if (BLOCKED_QUERY_PARAM_KEYS.some(b => b.toLowerCase() === lower) || key.length > 0) {
        rejectedParams.push(key);
      }
    }
  };

  checkSearchParams(String(search || ''));

  let cleanHash = String(hash || '#/guide');
  const qIndex = cleanHash.indexOf('?');
  if (qIndex >= 0) {
    checkSearchParams(cleanHash.slice(qIndex));
    cleanHash = cleanHash.slice(0, qIndex) || '#/guide';
  }

  return Object.freeze({
    cleanHash: cleanHash || '#/guide',
    rejected: rejectedParams.length > 0,
    rejectedParams: Object.freeze([...new Set(rejectedParams)]),
  });
}

// ---- O9 Strict Neutrality Validators ----
export function validateNeutralText(text, fieldName = 'text') {
  const problems = [];
  if (typeof text !== 'string') return problems;
  for (const rule of FORBIDDEN_O9_PATTERNS) {
    if (rule.pattern.test(text)) {
      problems.push({ field: fieldName, code: rule.code, match: text.match(rule.pattern)?.[0] || '' });
    }
  }
  return problems;
}

export function validateSortMode(sort) {
  if (!NEUTRAL_SORTS.includes(sort)) {
    return { ok: false, error: 'o9.non_neutral_sort_rejected', allowed: [...NEUTRAL_SORTS] };
  }
  return { ok: true, sort };
}

export function validateDirectoryScope(scope) {
  if (!DIRECTORY_SCOPES.includes(scope)) {
    return { ok: false, error: 'invalid-directory-scope', allowed: [...DIRECTORY_SCOPES] };
  }
  return { ok: true, scope };
}

export function validateLawyerRecord(record) {
  const problems = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return [{ field: 'record', code: 'record.invalid' }];
  }

  for (const key of Object.keys(record)) {
    if (FORBIDDEN_LAWYER_FIELDS.includes(key)) {
      problems.push({ field: key, code: 'o9.forbidden_field' });
    } else if (!ALLOWED_LAWYER_FACTUAL_FIELDS.includes(key)) {
      problems.push({ field: key, code: 'o9.undeclared_field' });
    }
  }

  // Mandatory fields per 日弁連 業務広告規程 第9条
  if (typeof record.name !== 'string' || !record.name.trim()) {
    problems.push({ field: 'name', code: 'lawyer.name_required' });
  }
  if (typeof record.bar_association !== 'string' || !record.bar_association.trim()) {
    problems.push({ field: 'bar_association', code: 'lawyer.bar_association_required' });
  }

  if (record.registration_number !== undefined && record.registration_number !== '') {
    if (typeof record.registration_number !== 'string' || !/^\d{4,7}$/.test(record.registration_number.trim())) {
      problems.push({ field: 'registration_number', code: 'lawyer.registration_number_invalid' });
    }
  }

  if (record.prefecture_code !== undefined && record.prefecture_code !== '') {
    if (!Object.hasOwn(PREFECTURE_MAP, record.prefecture_code)) {
      problems.push({ field: 'prefecture_code', code: 'lawyer.prefecture_invalid' });
    }
  }

  if (record.email !== undefined && record.email !== '') {
    if (typeof record.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email.trim())) {
      problems.push({ field: 'email', code: 'lawyer.email_invalid' });
    }
  }

  if (record.website_url !== undefined && record.website_url !== '') {
    try {
      const u = new URL(record.website_url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        problems.push({ field: 'website_url', code: 'lawyer.website_invalid' });
      }
    } catch {
      problems.push({ field: 'website_url', code: 'lawyer.website_invalid' });
    }
  }

  if (record.nichibenren_search_url !== undefined && record.nichibenren_search_url !== NICHIBENREN_SEARCH_URL) {
    problems.push({ field: 'nichibenren_search_url', code: 'o4.nichibenren_url_fixed' });
  }

  for (const field of ['name', 'office_name', 'address', 'initial_consultation_fee_note']) {
    if (typeof record[field] === 'string') {
      problems.push(...validateNeutralText(record[field], field));
    }
  }
  if (Array.isArray(record.practice_areas)) {
    record.practice_areas.forEach((area, idx) => {
      if (typeof area !== 'string' || !area.trim()) {
        problems.push({ field: `practice_areas[${idx}]`, code: 'lawyer.practice_area_invalid' });
      } else {
        problems.push(...validateNeutralText(area, `practice_areas[${idx}]`));
      }
    });
  }
  if (Array.isArray(record.career_facts)) {
    record.career_facts.forEach((fact, idx) => {
      if (typeof fact !== 'string') {
        problems.push({ field: `career_facts[${idx}]`, code: 'lawyer.career_fact_invalid' });
      } else {
        problems.push(...validateNeutralText(fact, `career_facts[${idx}]`));
      }
    });
  }
  if (Array.isArray(record.languages)) {
    record.languages.forEach((lang, idx) => {
      if (typeof lang !== 'string' || !lang.trim()) {
        problems.push({ field: `languages[${idx}]`, code: 'lawyer.language_invalid' });
      }
    });
  }

  if (!record.verification || typeof record.verification !== 'object') {
    problems.push({ field: 'verification', code: 'o4.verification_required' });
  } else {
    if (!VERIFICATION_STATUSES.includes(record.verification.status)) {
      problems.push({ field: 'verification.status', code: 'o4.verification_status_invalid' });
    }
    if (record.verification.status === 'verified_manual_a2') {
      if (record.verification.method !== VERIFICATION_METHOD_A2) {
        problems.push({ field: 'verification.method', code: 'o4.verification_method_must_be_a2' });
      }
      if (!record.verification.verified_at || Number.isNaN(Date.parse(record.verification.verified_at))) {
        problems.push({ field: 'verification.verified_at', code: 'o4.verified_at_required' });
      }
      if (!record.verification.expires_at || Number.isNaN(Date.parse(record.verification.expires_at))) {
        problems.push({ field: 'verification.expires_at', code: 'o4.expires_at_required' });
      }
      if (typeof record.verification.attestation_digest !== 'string' || !/^[0-9a-f]{64}$/.test(record.verification.attestation_digest)) {
        problems.push({ field: 'verification.attestation_digest', code: 'o4.attestation_digest_required' });
      }
    }
  }

  return problems;
}

// ---- O4 Qualification Verification State Machine ----
export function evaluateVerificationStatus(verification, nowIso = new Date().toISOString()) {
  if (!verification || typeof verification !== 'object' || !VERIFICATION_STATUSES.includes(verification.status)) {
    return Object.freeze({
      declaredStatus: verification?.status ?? 'unknown',
      effectiveStatus: 'unverified_self_declared',
      hardHold: true,
      liveSendAllowed: false,
      demoSendAllowed: false,
      manualContactAllowed: false,
      reason: 'o4.verification_invalid',
      nichibenrenSearchUrl: NICHIBENREN_SEARCH_URL,
    });
  }

  const nowMs = Date.parse(nowIso);
  let effectiveStatus = verification.status;
  let ttlExpired = false;

  if (verification.status === 'verified_manual_a2') {
    const verifiedMs = Date.parse(verification.verified_at || '');
    const expiresMs = Date.parse(verification.expires_at || '');
    const maxAllowedExpiresMs = Number.isNaN(verifiedMs) ? NaN : verifiedMs + VERIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000;
    if (
      verification.method !== VERIFICATION_METHOD_A2 ||
      Number.isNaN(verifiedMs) ||
      Number.isNaN(expiresMs) ||
      expiresMs > maxAllowedExpiresMs + 1000 ||
      expiresMs <= nowMs
    ) {
      effectiveStatus = 'expired';
      ttlExpired = true;
    }
  }

  if (effectiveStatus === 'suspended_or_revoked') {
    return Object.freeze({
      declaredStatus: verification.status,
      effectiveStatus,
      hardHold: true,
      liveSendAllowed: false,
      demoSendAllowed: false,
      manualContactAllowed: false,
      reason: 'o4.hard_hold_suspended_or_revoked',
      verifiedAt: verification.verified_at ?? null,
      expiresAt: verification.expires_at ?? null,
      method: verification.method ?? null,
      attestationDigest: verification.attestation_digest ?? null,
      nichibenrenSearchUrl: NICHIBENREN_SEARCH_URL,
    });
  }

  if (effectiveStatus === 'expired') {
    return Object.freeze({
      declaredStatus: verification.status,
      effectiveStatus,
      hardHold: true,
      liveSendAllowed: false,
      demoSendAllowed: false,
      manualContactAllowed: false,
      reason: ttlExpired ? 'o4.hard_hold_ttl_expired' : 'o4.hard_hold_expired',
      verifiedAt: verification.verified_at ?? null,
      expiresAt: verification.expires_at ?? null,
      method: verification.method ?? null,
      attestationDigest: verification.attestation_digest ?? null,
      nichibenrenSearchUrl: NICHIBENREN_SEARCH_URL,
    });
  }

  if (effectiveStatus === 'unverified_self_declared') {
    return Object.freeze({
      declaredStatus: verification.status,
      effectiveStatus,
      hardHold: false,
      liveSendAllowed: false,
      demoSendAllowed: true,
      manualContactAllowed: true,
      reason: 'o4.unverified_self_declared_blocks_live_send',
      verifiedAt: null,
      expiresAt: null,
      method: 'self_declared',
      attestationDigest: null,
      nichibenrenSearchUrl: NICHIBENREN_SEARCH_URL,
    });
  }

  return Object.freeze({
    declaredStatus: verification.status,
    effectiveStatus: 'verified_manual_a2',
    hardHold: false,
    liveSendAllowed: true,
    demoSendAllowed: true,
    manualContactAllowed: true,
    reason: 'o4.verified_manual_a2_active',
    verifiedAt: verification.verified_at,
    expiresAt: verification.expires_at,
    method: verification.method,
    attestationDigest: verification.attestation_digest,
    nichibenrenSearchUrl: NICHIBENREN_SEARCH_URL,
  });
}

export function canSendToLawyer(lawyer, { syntheticDemoMode = false, nowIso = new Date().toISOString() } = {}) {
  const status = evaluateVerificationStatus(lawyer?.verification, nowIso);
  if (status.hardHold) {
    return { allowed: false, hardHold: true, reason: status.reason, status };
  }
  if (status.effectiveStatus === 'unverified_self_declared') {
    if (syntheticDemoMode === true) {
      return { allowed: true, hardHold: false, demoOnly: true, reason: 'o4.synthetic_demo_only_override', status };
    }
    return { allowed: false, hardHold: false, reason: status.reason, status };
  }
  return { allowed: true, hardHold: false, demoOnly: false, reason: status.reason, status };
}

// ---- Method A: Exact 7-line Manual Copy Contact (blocked on expired / suspended_or_revoked) ----
export function formatManualContactText(lawyer, { nowIso = new Date().toISOString() } = {}) {
  if (!lawyer || typeof lawyer !== 'object') {
    throw Object.assign(new Error('lawyer-not-found'), { code: 'lawyer-not-found' });
  }
  const status = evaluateVerificationStatus(lawyer.verification, nowIso);
  if (status.hardHold) {
    throw Object.assign(new Error(status.reason), { code: status.reason, hardHold: true, status });
  }
  const lines = [
    `氏名: ${lawyer.name || '—'}`,
    `所属弁護士会: ${lawyer.bar_association || '—'}`,
    `登録番号: ${lawyer.registration_number || '—'}`,
    `法律事務所: ${lawyer.office_name || '—'}`,
    `所在地: ${lawyer.address || '—'}`,
    `連絡先: TEL ${lawyer.phone || '—'} / Email ${lawyer.email || '—'}`,
    `公式URL・日弁連検索: ${lawyer.website_url || '—'} | ${NICHIBENREN_SEARCH_URL}`,
  ];
  return lines.join('\n');
}

export function formatDraftCopyText(draft, lawyer = null) {
  const lines = [];
  if (lawyer) {
    lines.push(`宛先: ${lawyer.name}（${lawyer.bar_association}） / ${lawyer.office_name || '—'}`);
  }
  lines.push(`相談分野: ${draft?.category || 'other'}`);
  lines.push(`相談者氏名: ${draft?.clientName || ''}`);
  lines.push(`相談者連絡先: ${draft?.clientContact || ''}`);
  lines.push(`相手方（利益相反確認用）: ${draft?.counterpartyName || ''}`);
  lines.push(`相談の概要:\n${draft?.summary || ''}`);
  if (draft?.wish) lines.push(`希望する対応:\n${draft.wish}`);
  // Deadline is reproduced verbatim as user text — NEVER a countdown or remaining-days calculation.
  if (draft?.deadline) lines.push(`期限・期日（記載そのまま）: ${draft.deadline}`);
  if (Array.isArray(draft?.timeline) && draft.timeline.length) {
    lines.push('時系列:\n' + draft.timeline.map(t => `- ${t.date ? `${t.date} ` : ''}${t.event}`).join('\n'));
  }
  if (Array.isArray(draft?.documents) && draft.documents.length) {
    lines.push('関連書類:\n' + draft.documents.map(d => `- ${d}`).join('\n'));
  }
  if (Array.isArray(draft?.evidenceManifest) && draft.evidenceManifest.length) {
    lines.push('証拠一覧（evidence_manifest）:\n' + draft.evidenceManifest.map((e, i) =>
      `(${i + 1}) URL: ${e.url || '—'} | 投稿日時: ${e.posted_at || '—'} | 投稿者: ${e.author_name || '—'} (${e.author_id || '—'}) | 画像: ${e.shot_name || '—'} (${e.shot_size || 0} bytes) | 取得日時: ${e.captured_at || '—'} | SHA-256: ${e.sha256 || '—'}`
    ).join('\n'));
  }
  return lines.join('\n\n');
}

// ---- 日弁連 業務広告規程 第11条（令和8年7月1日施行済み）3年保存エクスポート ----
export function exportArt11Record(lawyer, editHistory = [], { nowIso = new Date().toISOString() } = {}) {
  const problems = validateLawyerRecord(lawyer);
  if (problems.length) {
    throw Object.assign(new Error('invalid-lawyer-record'), { code: 'invalid-lawyer-record', problems });
  }
  const exportedDate = new Date(nowIso);
  const retainUntilDate = new Date(exportedDate.getTime());
  retainUntilDate.setUTCFullYear(retainUntilDate.getUTCFullYear() + ART11_RETENTION_YEARS);

  const listingSnapshot = Object.freeze({
    id: lawyer.id,
    synthetic: Boolean(lawyer.synthetic),
    name: lawyer.name,
    name_kana: lawyer.name_kana || '',
    bar_association: lawyer.bar_association,
    registration_number: lawyer.registration_number || '',
    office_name: lawyer.office_name || '',
    prefecture_code: lawyer.prefecture_code || '',
    address: lawyer.address || '',
    phone: lawyer.phone || '',
    fax: lawyer.fax || '',
    email: lawyer.email || '',
    website_url: lawyer.website_url || '',
    practice_areas: [...(lawyer.practice_areas || [])],
    career_facts: [...(lawyer.career_facts || [])],
    languages: [...(lawyer.languages || [])],
    legal_aid_houterasu: Boolean(lawyer.legal_aid_houterasu),
    initial_consultation_fee_note: lawyer.initial_consultation_fee_note || '',
    nichibenren_search_url: NICHIBENREN_SEARCH_URL,
    verification: evaluateVerificationStatus(lawyer.verification, nowIso),
  });

  const snapshotSha256 = sha256Hex(JSON.stringify(listingSnapshot));
  const normalizedHistory = Array.isArray(editHistory) && editHistory.length > 0
    ? editHistory.map(h => Object.freeze({ ...h }))
    : [Object.freeze({ timestamp: nowIso, action: 'initial_snapshot', snapshot_sha256: snapshotSha256 })];

  const body = {
    schema: 'bengoshi.art11.record.v1',
    regulation: '日弁連 業務広告規程 第11条（令和8年7月1日施行）',
    retention_years: ART11_RETENTION_YEARS,
    exported_at: nowIso,
    retain_until: retainUntilDate.toISOString(),
    free_participation_terms: Object.freeze({
      fee_jpy: 0,
      model: 'none',
      free_for_users: true,
      free_for_lawyers: true,
      referral_fee: false,
      fee_splitting: false,
      ads: false,
      sponsored_placement: false,
      paid_tier: false,
      token_reward: false,
      scout_or_reverse_offer: false,
      online_retainer_signing: false,
    }),
    listing_snapshot: listingSnapshot,
    snapshot_sha256: snapshotSha256,
    edit_history: Object.freeze(normalizedHistory),
  };

  return Object.freeze({
    ...body,
    record_sha256: sha256Hex(JSON.stringify(body)),
  });
}

export function validateOnboardingSubmission(submission) {
  const problems = [];
  if (!submission || typeof submission !== 'object') {
    return [{ field: 'submission', code: 'onboarding.invalid' }];
  }
  for (const forbidden of FORBIDDEN_ONBOARDING_FIELDS) {
    if (Object.hasOwn(submission, forbidden) && submission[forbidden]) {
      problems.push({ field: forbidden, code: 'o4.id_photo_or_scraping_prohibited' });
    }
  }
  if (submission.verification_method && submission.verification_method !== VERIFICATION_METHOD_A2 && submission.verification_method !== 'self_declared') {
    problems.push({ field: 'verification_method', code: 'o4.unsupported_verification_method' });
  }
  if (typeof submission.name !== 'string' || !submission.name.trim()) {
    problems.push({ field: 'name', code: 'lawyer.name_required' });
  }
  if (typeof submission.bar_association !== 'string' || !submission.bar_association.trim()) {
    problems.push({ field: 'bar_association', code: 'lawyer.bar_association_required' });
  }
  if (typeof submission.registration_number !== 'string' || !/^\d{4,7}$/.test(submission.registration_number.trim())) {
    problems.push({ field: 'registration_number', code: 'lawyer.registration_number_invalid' });
  }
  if (typeof submission.office_name !== 'string' || !submission.office_name.trim()) {
    problems.push({ field: 'office_name', code: 'onboarding.office_name_required' });
  }
  if (typeof submission.phone !== 'string' || !submission.phone.trim()) {
    problems.push({ field: 'phone', code: 'onboarding.office_contact_required' });
  }
  problems.push(...validateNeutralText(submission.name || '', 'name'));
  problems.push(...validateNeutralText(submission.office_name || '', 'office_name'));
  return problems;
}

// ---- Neutral Directory Search & Sort ----
export function filterAndSortLawyers(lawyers, {
  query = '',
  prefectureCode = '',
  practiceArea = '',
  language = '',
  legalAidHouterasu = null,
  verificationStatus = '',
  sort = 'kana_asc',
  directoryScope = 'tenant_only',
  tenantId = 'default-tenant',
  nowIso = new Date().toISOString(),
} = {}) {
  const sortCheck = validateSortMode(sort);
  if (!sortCheck.ok) throw Object.assign(new Error(sortCheck.error), { code: sortCheck.error });
  const scopeCheck = validateDirectoryScope(directoryScope);
  if (!scopeCheck.ok) throw Object.assign(new Error(scopeCheck.error), { code: scopeCheck.error });

  const q = String(query || '').normalize('NFKC').trim().toLowerCase();

  const filtered = (Array.isArray(lawyers) ? lawyers : []).filter(lawyer => {
    if (directoryScope === 'tenant_only' && tenantId && lawyer.tenant_id && lawyer.tenant_id !== tenantId) {
      return false;
    }
    if (prefectureCode && lawyer.prefecture_code !== prefectureCode) return false;
    if (practiceArea && !(lawyer.practice_areas || []).includes(practiceArea)) return false;
    if (language && !(lawyer.languages || []).includes(language)) return false;
    if (legalAidHouterasu === true && lawyer.legal_aid_houterasu !== true) return false;
    if (legalAidHouterasu === false && lawyer.legal_aid_houterasu !== false) return false;

    const evaluated = evaluateVerificationStatus(lawyer.verification, nowIso);
    if (verificationStatus && evaluated.effectiveStatus !== verificationStatus) return false;

    if (q) {
      const haystack = [
        lawyer.name,
        lawyer.name_kana,
        lawyer.bar_association,
        lawyer.registration_number,
        lawyer.office_name,
        PREFECTURE_MAP[lawyer.prefecture_code] || '',
        lawyer.address,
        ...(lawyer.practice_areas || []),
        ...(lawyer.languages || []),
      ]
        .join(' ')
        .normalize('NFKC')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'reg_no_asc') {
      const na = parseInt(a.registration_number || '0', 10);
      const nb = parseInt(b.registration_number || '0', 10);
      if (na !== nb) return na - nb;
      return String(a.id).localeCompare(String(b.id));
    }
    if (sort === 'prefecture_asc') {
      const pa = String(a.prefecture_code || '99');
      const pb = String(b.prefecture_code || '99');
      if (pa !== pb) return pa.localeCompare(pb);
      return String(a.name_kana || a.name).localeCompare(String(b.name_kana || b.name), 'ja');
    }
    // Default: kana_asc (五十音順)
    const ka = String(a.name_kana || a.name);
    const kb = String(b.name_kana || b.name);
    const cmp = ka.localeCompare(kb, 'ja');
    return cmp !== 0 ? cmp : String(a.registration_number || '').localeCompare(String(b.registration_number || ''));
  });

  return sorted.map(l => ({
    ...l,
    evaluatedVerification: evaluateVerificationStatus(l.verification, nowIso),
  }));
}

// ---- Inquiry Draft & Exact Soudan Memo Import (soudan.memo.export.v1) ----
export function emptyInquiryDraft(lawyerId = '') {
  return {
    lawyerId,
    template: SOUDAN_TEMPLATE_ID,
    category: 'other',
    clientName: '',
    clientContact: '',
    counterpartyName: '',
    summary: '',
    timeline: [],
    wish: '',
    deadline: '',
    documents: [],
    evidenceManifest: [],
    evidenceHashes: [],
    importedFromSoudan: false,
    importedAt: null,
  };
}

export function validateInquiryDraft(draft) {
  const problems = [];
  if (!draft || typeof draft !== 'object') return ['draft.invalid'];
  if (typeof draft.lawyerId !== 'string' || !draft.lawyerId.trim()) problems.push('draft.lawyer_required');
  if (!INQUIRY_CATEGORIES.includes(draft.category)) problems.push('draft.category_invalid');
  if (typeof draft.clientName !== 'string' || !draft.clientName.trim()) problems.push('draft.client_name_required');
  if (typeof draft.clientContact !== 'string' || !draft.clientContact.trim()) problems.push('draft.client_contact_required');
  if (typeof draft.counterpartyName !== 'string' || !draft.counterpartyName.trim()) problems.push('draft.counterparty_required');
  if (typeof draft.summary !== 'string' || !draft.summary.trim() || [...draft.summary].length > 4000) problems.push('draft.summary_required');

  const manifest = Array.isArray(draft.evidenceManifest)
    ? draft.evidenceManifest
    : Array.isArray(draft.evidenceHashes) ? draft.evidenceHashes : [];
  for (const item of manifest) {
    if (!item || typeof item !== 'object' || (item.sha256 && !/^[0-9a-f]{64}$/.test(item.sha256))) {
      problems.push('draft.evidence_hash_invalid');
      break;
    }
  }
  return problems;
}

export function normalizeEvidenceManifestRow(e) {
  const rawSize = e.shot_size ?? e.shotSize ?? 0;
  const shotSize = Number.isSafeInteger(rawSize) && rawSize >= 0 ? rawSize : 0;
  const rawSha = typeof e.sha256 === 'string' ? e.sha256.trim() : '';
  return {
    url: typeof e.url === 'string' ? e.url.trim() : '',
    posted_at: typeof (e.posted_at ?? e.postedAt) === 'string' ? (e.posted_at ?? e.postedAt).trim() : '',
    author_name: typeof (e.author_name ?? e.authorName) === 'string' ? (e.author_name ?? e.authorName).trim() : '',
    author_id: typeof (e.author_id ?? e.authorId) === 'string' ? (e.author_id ?? e.authorId).trim() : '',
    shot_name: typeof (e.shot_name ?? e.shotName) === 'string' ? (e.shot_name ?? e.shotName).trim() : '',
    shot_size: shotSize,
    captured_at: typeof (e.captured_at ?? e.capturedAt) === 'string' ? (e.captured_at ?? e.capturedAt).trim() : '',
    sha256: /^[0-9a-f]{64}$/.test(rawSha) ? rawSha : '',
  };
}

export function parseSoudanMemoExport(input) {
  let obj = input;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch {
      throw Object.assign(new Error('soudan.invalid_json'), { code: 'soudan.invalid_json' });
    }
  }
  if (!obj || typeof obj !== 'object' || obj.schema !== 'soudan.memo.export.v1') {
    throw Object.assign(new Error('soudan.unsupported_schema'), { code: 'soudan.unsupported_schema' });
  }
  const src = obj.memo && typeof obj.memo === 'object' ? obj.memo : obj;
  const template = obj.template ?? src.template ?? SOUDAN_TEMPLATE_ID;
  if (template !== SOUDAN_TEMPLATE_ID) {
    throw Object.assign(new Error('soudan.unsupported_template'), { code: 'soudan.unsupported_template' });
  }

  const draft = emptyInquiryDraft('');
  draft.template = template;
  draft.category = INQUIRY_CATEGORIES.includes(src.category) ? src.category : 'other';
  draft.clientName = typeof (src.name ?? src.client_name) === 'string' ? (src.name ?? src.client_name).trim() : '';
  draft.clientContact = typeof (src.contact ?? src.client_contact) === 'string' ? (src.contact ?? src.client_contact).trim() : '';
  draft.counterpartyName = typeof (src.otherParty ?? src.other_party) === 'string' ? (src.otherParty ?? src.other_party).trim() : '';
  draft.summary = typeof src.summary === 'string' ? src.summary.trim() : '';
  draft.wish = typeof src.wish === 'string' ? src.wish.trim() : '';
  // Deadline kept strictly verbatim — zero countdown or remaining-days computation.
  draft.deadline = typeof src.deadline === 'string' ? src.deadline.trim() : '';
  draft.timeline = Array.isArray(src.timeline)
    ? src.timeline
        .filter(t => t && typeof t.event === 'string' && t.event.trim())
        .slice(0, 30)
        .map(t => ({ date: typeof t.date === 'string' ? t.date.trim() : '', event: t.event.trim() }))
    : [];
  draft.documents = Array.isArray(src.documents)
    ? src.documents.filter(d => typeof d === 'string' && d.trim()).slice(0, 30).map(d => d.trim())
    : [];

  const rawManifest = Array.isArray(obj.evidence_manifest)
    ? obj.evidence_manifest
    : Array.isArray(src.evidence_manifest)
      ? src.evidence_manifest
      : Array.isArray(src.evidence)
        ? src.evidence
        : [];
  draft.evidenceManifest = rawManifest
    .filter(e => e && typeof e === 'object')
    .slice(0, 30)
    .map(normalizeEvidenceManifestRow);
  draft.evidenceHashes = draft.evidenceManifest.map(e => ({
    url: e.url,
    shotName: e.shot_name,
    sha256: e.sha256,
    capturedAt: e.captured_at,
  }));
  draft.importedFromSoudan = true;
  draft.importedAt = new Date().toISOString();
  return draft;
}

// ---- Lawyer Card Export (bengoshi.lawyer.card.v1) ----
export function exportLawyerCard(lawyer, nowIso = new Date().toISOString()) {
  const problems = validateLawyerRecord(lawyer);
  if (problems.length) {
    throw Object.assign(new Error('invalid-lawyer-record'), { code: 'invalid-lawyer-record', problems });
  }
  const evaluated = evaluateVerificationStatus(lawyer.verification, nowIso);
  let manualContactText = null;
  if (!evaluated.hardHold) {
    manualContactText = formatManualContactText(lawyer, { nowIso });
  }
  return Object.freeze({
    schema: 'bengoshi.lawyer.card.v1',
    exportedAt: nowIso,
    policy: ZERO_FEE_POLICY,
    lawyer: Object.freeze({
      id: lawyer.id,
      synthetic: Boolean(lawyer.synthetic),
      name: lawyer.name,
      name_kana: lawyer.name_kana || '',
      bar_association: lawyer.bar_association,
      registration_number: lawyer.registration_number || '',
      office_name: lawyer.office_name || '',
      prefecture_code: lawyer.prefecture_code || '',
      prefecture_name: PREFECTURE_MAP[lawyer.prefecture_code] || '',
      address: lawyer.address || '',
      phone: lawyer.phone || '',
      fax: lawyer.fax || '',
      email: lawyer.email || '',
      website_url: lawyer.website_url || '',
      practice_areas: [...(lawyer.practice_areas || [])],
      career_facts: [...(lawyer.career_facts || [])],
      languages: [...(lawyer.languages || [])],
      legal_aid_houterasu: Boolean(lawyer.legal_aid_houterasu),
      initial_consultation_fee_note: lawyer.initial_consultation_fee_note || '',
      nichibenren_search_url: NICHIBENREN_SEARCH_URL,
    }),
    verification: evaluated,
    manualContactText,
  });
}

// ---- Lawyer Conflict-Check HARD Gate (AWAI-3235, strictly local preview / offline import) ----
function normalizePartyName(name) {
  return String(name || '')
    .normalize('NFKC')
    .replace(/[\s　・\-‐‑–—()（）株式会社有限会社合同会社]/gu, '')
    .toLowerCase()
    .trim();
}

export function extractConflictHeader(intakeRecord) {
  const h = intakeRecord?.conflictHeader || intakeRecord?.envelope?.conflictHeader;
  if (!h || typeof h !== 'object') throw new TypeError('missing-conflict-header');
  return Object.freeze({
    inquiryId: String(h.inquiryId || intakeRecord.inquiryId || ''),
    clientName: String(h.clientName || ''),
    counterpartyName: String(h.counterpartyName || ''),
    category: String(h.category || 'other'),
    receivedAt: String(h.receivedAt || intakeRecord.receivedAt || ''),
  });
}

export function runLocalConflictCheck(header, ledgerEntries = [], { checkedAt = new Date().toISOString() } = {}) {
  const normClient = normalizePartyName(header?.clientName);
  const normCounter = normalizePartyName(header?.counterpartyName);
  const matches = [];

  for (const entry of Array.isArray(ledgerEntries) ? ledgerEntries : []) {
    const normEntry = normalizePartyName(entry?.partyName);
    if (!normEntry) continue;
    const hitClient = normClient && (normClient === normEntry || normClient.includes(normEntry) || normEntry.includes(normClient));
    const hitCounter = normCounter && (normCounter === normEntry || normCounter.includes(normEntry) || normEntry.includes(normCounter));
    if (hitClient || hitCounter) {
      matches.push({
        ledgerId: entry.id || 'unknown',
        partyName: entry.partyName,
        role: entry.role || 'existing_party',
        matterRef: entry.matterRef || '',
        matchedField: hitCounter ? 'counterpartyName' : 'clientName',
      });
    }
  }

  const result = matches.length > 0 ? 'conflict_detected' : 'clear';
  const receiptMaterial = JSON.stringify({
    inquiryId: header?.inquiryId || '',
    clientName: header?.clientName || '',
    counterpartyName: header?.counterpartyName || '',
    result,
    matchCount: matches.length,
    checkedAt,
  });
  return Object.freeze({
    inquiryId: header?.inquiryId || '',
    result,
    matches: Object.freeze(matches),
    checkedAt,
    confirmedByLawyer: false,
    confirmedAt: null,
    receiptDigest: sha256Hex(receiptMaterial),
  });
}

export function canRevealInquiryBody(intakeRecord) {
  const cc = intakeRecord?.conflictCheck;
  if (!cc || typeof cc !== 'object') {
    return { allowed: false, reason: 'conflict_gate.check_required' };
  }
  if (cc.result === 'conflict_detected') {
    return { allowed: false, reason: 'conflict_gate.conflict_detected_hard_block' };
  }
  if (cc.result !== 'clear') {
    return { allowed: false, reason: 'conflict_gate.invalid_status' };
  }
  if (cc.confirmedByLawyer !== true || !cc.receiptDigest) {
    return { allowed: false, reason: 'conflict_gate.lawyer_confirmation_required' };
  }
  return { allowed: true, reason: 'conflict_gate.cleared_and_confirmed' };
}

// ---- Append-only Local Audit Log ----
export function appendAuditEntry(log, { actor = 'ui', operation, outcome, summary = '', details = {}, timestamp = new Date().toISOString() }) {
  const entries = Array.isArray(log) ? [...log] : [];
  const prevHash = entries.length ? entries[entries.length - 1].entryHash : '0'.repeat(64);
  const seq = entries.length + 1;
  const payload = { seq, timestamp, actor, operation, outcome, summary, details, prevHash };
  const entryHash = sha256Hex(JSON.stringify(payload));
  const entry = Object.freeze({ ...payload, entryHash });
  entries.push(entry);
  return { log: entries, entry };
}

export function verifyAuditChain(log) {
  if (!Array.isArray(log)) return { ok: false, brokenAt: 0 };
  let expectedPrev = '0'.repeat(64);
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.seq !== i + 1 || e.prevHash !== expectedPrev) return { ok: false, brokenAt: i };
    const { entryHash, ...rest } = e;
    if (sha256Hex(JSON.stringify(rest)) !== entryHash) return { ok: false, brokenAt: i };
    expectedPrev = entryHash;
  }
  return { ok: true, length: log.length };
}
