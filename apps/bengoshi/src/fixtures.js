// Signed read-only local synthetic fixture catalog for Bengoshi (network.itonami.bengoshi).
// 100% synthetic sample lawyers (`synthetic: true`, `.invalid` domains, fictional registration numbers 990001..990006)
// covering all 4 O4 verification states so QA and automated tests can exercise every state & HARD hold.
// Zero real lawyers; zero real personal data; zero private keys committed to source.

import { NICHIBENREN_SEARCH_URL } from './legal-notices.js';
import { sha256Hex, VERIFICATION_METHOD_A2 } from './model.js';
import { encryptEnvelope } from './crypto.js';

// Synthetic public-only RSA-OAEP-256 JWK for QA fixture encryption (non-secret public key).
export const SYNTHETIC_QA_PUBLIC_JWK = Object.freeze({
  kty: 'RSA',
  alg: 'RSA-OAEP-256',
  ext: true,
  key_ops: Object.freeze(['encrypt']),
  n: 'zeBBUqO8qM5HyMnwku_n-DysK8-32PwqwAnYsekIQqjf2s_E_pFKKIyXjYdfgu4cEq1cVPCno9XB4WzY0Sl4wxk4txKER0YG2_niQoWWpw219vUyqSHxE0xJAHhbIhSy2DJgvIjJhK8nkHJA7a5-jkRwtXx1dXHSzvryzg-J_aOG8FNMrubJs6MpIGgDFq9d40VZ8leluJkcwQ3WXyEIqvfPyyEorFPUfrJa8-zDedEbWbDzf1Yyfp_SWY7UhF4dK5O6KtPo527b-MmYkAaVBskS5LsfMPjxtVgKtGwgqbdFGxicE-r9TtnVXlCu2zYvBxgv1Rt0cAEITdhrX38N7Q',
  e: 'AQAB',
});

export const SYNTHETIC_QA_KEY_FINGERPRINT = 'cda934518466639f736e3120e17fdb1126e985b2b3e50ab93336569b8cdbc678';

function attestationDigest(id, regNo, verifiedAt) {
  return sha256Hex(`bengoshi.a2.attestation.v1:${id}:${regNo}:${verifiedAt}`);
}

const RAW_SYNTHETIC_LAWYERS = [
  {
    id: 'syn-lawyer-990001',
    synthetic: true,
    tenant_id: 'default-tenant',
    name: '佐藤 遥（架空サンプル）',
    name_kana: 'さとう はるか',
    bar_association: '大阪弁護士会',
    registration_number: '990001',
    office_name: 'サンプル中之島法律事務所',
    prefecture_code: '27',
    address: '大阪府大阪市北区中之島0-0-0（架空住所）',
    phone: '06-0000-0001',
    fax: '06-0000-0011',
    email: 'sample-990001@office-990001.example.invalid',
    website_url: 'https://office-990001.example.invalid/',
    practice_areas: ['民事一般', '労働', '消費者問題'],
    career_facts: ['2018年 司法修習修了・弁護士登録（架空データ）', '2022年 サンプル中之島法律事務所開設（架空データ）'],
    languages: ['日本語', 'English'],
    legal_aid_houterasu: true,
    initial_consultation_fee_note: '初回30分5,500円（法テラス利用要件を満たす場合は無料相談制度あり）',
    nichibenren_search_url: NICHIBENREN_SEARCH_URL,
    verification: {
      status: 'verified_manual_a2',
      verified_at: '2026-11-20T00:00:00Z',
      expires_at: '2026-12-20T00:00:00Z',
      method: VERIFICATION_METHOD_A2,
      attestation_digest: attestationDigest('syn-lawyer-990001', '990001', '2026-11-20T00:00:00Z'),
    },
    e2ee_public_key_jwk: SYNTHETIC_QA_PUBLIC_JWK,
    e2ee_key_fingerprint: SYNTHETIC_QA_KEY_FINGERPRINT,
  },
  {
    id: 'syn-lawyer-990002',
    synthetic: true,
    tenant_id: 'default-tenant',
    name: '青木 匠（架空サンプル）',
    name_kana: 'あおき たくみ',
    bar_association: '東京弁護士会',
    registration_number: '990002',
    office_name: 'サンプル霞が関共同法律事務所',
    prefecture_code: '13',
    address: '東京都千代田区霞が関0-0-0（架空住所）',
    phone: '03-0000-0002',
    fax: '03-0000-0012',
    email: 'sample-990002@office-990002.example.invalid',
    website_url: 'https://office-990002.example.invalid/',
    practice_areas: ['家事・相続', '不動産・建築', 'インターネット関係'],
    career_facts: ['2015年 弁護士登録（架空データ）', '2020年 東京弁護士会 民事関係委員会委員（架空データ）'],
    languages: ['日本語'],
    legal_aid_houterasu: true,
    initial_consultation_fee_note: '初回相談30分無料（平日10:00-17:00・要予約）',
    nichibenren_search_url: NICHIBENREN_SEARCH_URL,
    verification: {
      status: 'verified_manual_a2',
      verified_at: '2026-11-22T00:00:00Z',
      expires_at: '2026-12-22T00:00:00Z',
      method: VERIFICATION_METHOD_A2,
      attestation_digest: attestationDigest('syn-lawyer-990002', '990002', '2026-11-22T00:00:00Z'),
    },
    e2ee_public_key_jwk: SYNTHETIC_QA_PUBLIC_JWK,
    e2ee_key_fingerprint: SYNTHETIC_QA_KEY_FINGERPRINT,
  },
  {
    id: 'syn-lawyer-990003',
    synthetic: true,
    tenant_id: 'cross-firm-tenant',
    name: '渡辺 裕子（架空サンプル）',
    name_kana: 'わたなべ ゆうこ',
    bar_association: '札幌弁護士会',
    registration_number: '990003',
    office_name: 'サンプル大通法律事務所',
    prefecture_code: '01',
    address: '北海道札幌市中央区大通西0-0-0（架空住所）',
    phone: '011-000-0003',
    fax: '011-000-0013',
    email: 'sample-990003@office-990003.example.invalid',
    website_url: 'https://office-990003.example.invalid/',
    practice_areas: ['企業法務・契約', '知的財産', '民事一般'],
    career_facts: ['2012年 弁護士登録（架空データ）', '2019年 サンプル大通法律事務所パートナー（架空データ）'],
    languages: ['日本語', 'English', '中文'],
    legal_aid_houterasu: false,
    initial_consultation_fee_note: '初回60分11,000円（税込）',
    nichibenren_search_url: NICHIBENREN_SEARCH_URL,
    verification: {
      status: 'verified_manual_a2',
      verified_at: '2026-11-25T00:00:00Z',
      expires_at: '2026-12-25T00:00:00Z',
      method: VERIFICATION_METHOD_A2,
      attestation_digest: attestationDigest('syn-lawyer-990003', '990003', '2026-11-25T00:00:00Z'),
    },
    e2ee_public_key_jwk: SYNTHETIC_QA_PUBLIC_JWK,
    e2ee_key_fingerprint: SYNTHETIC_QA_KEY_FINGERPRINT,
  },
  {
    id: 'syn-lawyer-990004',
    synthetic: true,
    tenant_id: 'default-tenant',
    name: '高橋 健一（架空サンプル・未照合）',
    name_kana: 'たかはし けんいち',
    bar_association: '福岡県弁護士会',
    registration_number: '990004',
    office_name: 'サンプル天神法律事務所',
    prefecture_code: '40',
    address: '福岡県福岡市中央区天神0-0-0（架空住所）',
    phone: '092-000-0004',
    fax: '',
    email: 'sample-990004@office-990004.example.invalid',
    website_url: 'https://office-990004.example.invalid/',
    practice_areas: ['債務整理', '交通事故'],
    career_facts: ['2024年 自己申告登録（手動照合未完了・架空データ）'],
    languages: ['日本語'],
    legal_aid_houterasu: true,
    initial_consultation_fee_note: '初回30分5,500円（自己申告）',
    nichibenren_search_url: NICHIBENREN_SEARCH_URL,
    verification: {
      status: 'unverified_self_declared',
      verified_at: null,
      expires_at: null,
      method: 'self_declared',
      attestation_digest: null,
    },
    e2ee_public_key_jwk: SYNTHETIC_QA_PUBLIC_JWK,
    e2ee_key_fingerprint: SYNTHETIC_QA_KEY_FINGERPRINT,
  },
  {
    id: 'syn-lawyer-990005',
    synthetic: true,
    tenant_id: 'default-tenant',
    name: '中村 美咲（架空サンプル・期限切れ）',
    name_kana: 'なかむら みさき',
    bar_association: '愛知県弁護士会',
    registration_number: '990005',
    office_name: 'サンプル栄法律事務所',
    prefecture_code: '23',
    address: '愛知県名古屋市中区栄0-0-0（架空住所）',
    phone: '052-000-0005',
    fax: '',
    email: 'sample-990005@office-990005.example.invalid',
    website_url: 'https://office-990005.example.invalid/',
    practice_areas: ['家事・相続', '民事一般'],
    career_facts: ['2016年 弁護士登録（架空データ・手動照合有効期限切れテスト用）'],
    languages: ['日本語'],
    legal_aid_houterasu: false,
    initial_consultation_fee_note: '初回30分5,500円',
    nichibenren_search_url: NICHIBENREN_SEARCH_URL,
    verification: {
      status: 'expired',
      verified_at: '2026-09-01T00:00:00Z',
      expires_at: '2026-10-01T00:00:00Z',
      method: VERIFICATION_METHOD_A2,
      attestation_digest: attestationDigest('syn-lawyer-990005', '990005', '2026-09-01T00:00:00Z'),
    },
    e2ee_public_key_jwk: SYNTHETIC_QA_PUBLIC_JWK,
    e2ee_key_fingerprint: SYNTHETIC_QA_KEY_FINGERPRINT,
  },
  {
    id: 'syn-lawyer-990006',
    synthetic: true,
    tenant_id: 'default-tenant',
    name: '小林 誠（架空サンプル・業務停止）',
    name_kana: 'こばやし まこと',
    bar_association: '神奈川県弁護士会',
    registration_number: '990006',
    office_name: 'サンプル関内法律事務所',
    prefecture_code: '14',
    address: '神奈川県横浜市中区尾上町0-0-0（架空住所）',
    phone: '045-000-0006',
    fax: '',
    email: 'sample-990006@office-990006.example.invalid',
    website_url: 'https://office-990006.example.invalid/',
    practice_areas: ['刑事弁護', '民事一般'],
    career_facts: ['2014年 弁護士登録（架空データ・業務停止/退会HARD HOLDテスト用）'],
    languages: ['日本語'],
    legal_aid_houterasu: false,
    initial_consultation_fee_note: '現在受付停止中（テスト用）',
    nichibenren_search_url: NICHIBENREN_SEARCH_URL,
    verification: {
      status: 'suspended_or_revoked',
      verified_at: '2026-10-15T00:00:00Z',
      expires_at: '2026-11-14T00:00:00Z',
      method: VERIFICATION_METHOD_A2,
      attestation_digest: attestationDigest('syn-lawyer-990006', '990006', '2026-10-15T00:00:00Z'),
    },
    e2ee_public_key_jwk: SYNTHETIC_QA_PUBLIC_JWK,
    e2ee_key_fingerprint: SYNTHETIC_QA_KEY_FINGERPRINT,
  },
];

export const SYNTHETIC_CATALOG_BUNDLE = Object.freeze({
  schema: 'bengoshi.directory.fixture-bundle.v1',
  synthetic: true,
  readOnly: true,
  generatedAt: '2026-11-27T00:00:00Z',
  lawyers: Object.freeze(RAW_SYNTHETIC_LAWYERS),
  digestSha256: sha256Hex(JSON.stringify(RAW_SYNTHETIC_LAWYERS)),
});

export function verifySyntheticCatalogIntegrity(bundle = SYNTHETIC_CATALOG_BUNDLE) {
  const actual = sha256Hex(JSON.stringify(bundle.lawyers));
  const allSynthetic = Array.isArray(bundle.lawyers) && bundle.lawyers.every(l => l.synthetic === true);
  const allInvalidDomains = Array.isArray(bundle.lawyers) && bundle.lawyers.every(l => {
    const webOk = !l.website_url || new URL(l.website_url).hostname.endsWith('.invalid');
    const mailOk = !l.email || l.email.endsWith('.invalid');
    return webOk && mailOk;
  });
  return {
    ok: actual === bundle.digestSha256 && bundle.synthetic === true && allSynthetic && allInvalidDomains,
    expected: bundle.digestSha256,
    actual,
    allSynthetic,
    allInvalidDomains,
  };
}

// Default local conflict ledger (device-only, lawyer-side QA sample).
export const DEFAULT_LOCAL_CONFLICT_LEDGER = Object.freeze([
  Object.freeze({
    id: 'ledger-001',
    partyName: 'サンプル商事株式会社',
    role: 'existing_client',
    matterRef: '2026-C-0012（顧問先・架空データ）',
  }),
  Object.freeze({
    id: 'ledger-002',
    partyName: '架空不動産株式会社',
    role: 'adverse_party',
    matterRef: '2025-L-0048（係争相手方・架空データ）',
  }),
]);

// Build encrypted QA inbox items on-device using a runtime-generated ephemeral keypair.
// Strictly local preview / offline import — ZERO platform server relay.
export async function buildSyntheticQaIntakeRecords(lawyerId, recipientPublicKeyJwk) {
  const clearHeader = {
    inquiryId: 'inq-qa-clear-001',
    clientName: '山田 花子（架空相談者）',
    counterpartyName: '無関係建設株式会社（架空相手方）',
    category: 'work',
    receivedAt: '2026-11-27T01:00:00Z',
  };
  const clearEnvelope = await encryptEnvelope({
    recipientLawyerId: lawyerId,
    recipientPublicKeyJwk,
    conflictHeader: clearHeader,
    plaintext: {
      summary: '未払い残業代の請求方法について初回相談を希望します（架空QAデータ）。',
      clientContact: 'hanako.sample@example.invalid',
      wish: '法的手続の見通しと必要書類を確認したい。',
      deadline: '2026-12-15',
      timeline: [{ date: '2026-10-31', event: '退職（架空データ）' }],
      documents: ['雇用契約書写し', '勤怠記録'],
      evidenceManifest: [],
    },
  });

  const conflictHeader = {
    inquiryId: 'inq-qa-conflict-002',
    clientName: '鈴木 一郎（架空相談者）',
    counterpartyName: 'サンプル商事株式会社',
    category: 'contract',
    receivedAt: '2026-11-27T02:00:00Z',
  };
  const conflictEnvelope = await encryptEnvelope({
    recipientLawyerId: lawyerId,
    recipientPublicKeyJwk,
    conflictHeader,
    plaintext: {
      summary: '機密本文：利益相反がある場合は復号・閲覧されてはならない本文（架空QAデータ）。',
      clientContact: 'ichiro.sample@example.invalid',
      wish: '取引契約の解除を相談したい。',
      deadline: '',
      timeline: [],
      documents: ['業務委託契約書'],
      evidenceManifest: [],
    },
  });

  return [
    {
      inquiryId: clearHeader.inquiryId,
      receivedAt: clearHeader.receivedAt,
      conflictHeader: clearHeader,
      envelope: clearEnvelope,
      conflictCheck: null,
      decision: null,
      replySentAt: null,
    },
    {
      inquiryId: conflictHeader.inquiryId,
      receivedAt: conflictHeader.receivedAt,
      conflictHeader,
      envelope: conflictEnvelope,
      conflictCheck: null,
      decision: null,
      replySentAt: null,
    },
  ];
}
