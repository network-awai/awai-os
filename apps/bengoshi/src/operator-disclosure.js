// Operator disclosure slot for Bengoshi (network.itonami.bengoshi).
// Populated with Legal #224 confirmed entity and domestic contact details prior to public cutover.

export const OPERATOR_DISCLOSURE_STATUS = 'PENDING_OWNER_CONFIRMATION_LEGAL_224';

export const OPERATOR_DISCLOSURE = Object.freeze({
  status: OPERATOR_DISCLOSURE_STATUS,
  entityName: {
    ja: '運営主体情報：確認中（PENDING_OWNER_CONFIRMATION_LEGAL_224）',
    en: 'Operator entity: Pending confirmation (PENDING_OWNER_CONFIRMATION_LEGAL_224)',
  },
  domesticContact: {
    ja: '国内連絡窓口：外部弁護士確認（O10）および Legal #224 確定後に記載',
    en: 'Domestic contact: To be published after O10 external legal review and Legal #224 confirmation',
  },
  feePolicy: {
    ja: '対価区分：完全無料（利用者 ¥0 ／ 弁護士 ¥0）',
    en: 'Fee policy: Completely free (Users JPY 0 / Lawyers JPY 0)',
  },
  legalBasisNote: {
    ja: '本画面は公的弁護士検索ガイドおよび中立ディレクトリ構造のプレビューです。実在する弁護士・法律事務所の掲載・登録受付・連絡取次は外部弁護士確認（O10）完了後に開始します。',
    en: 'This screen provides an official lawyer search guide and a neutral directory structure preview. Real lawyer listings, registration intake, and contact handling remain closed until external legal review (O10) is completed.',
  },
});

export function getOperatorDisclosure(locale = 'ja') {
  const lang = locale === 'en' ? 'en' : 'ja';
  return Object.freeze({
    status: OPERATOR_DISCLOSURE.status,
    entityName: OPERATOR_DISCLOSURE.entityName[lang],
    domesticContact: OPERATOR_DISCLOSURE.domesticContact[lang],
    feePolicy: OPERATOR_DISCLOSURE.feePolicy[lang],
    legalBasisNote: OPERATOR_DISCLOSURE.legalBasisNote[lang],
  });
}
