// Centralized legal and privacy notices for Bengoshi (network.itonami.bengoshi).
// Kept in a single module so Legal's final wording (O4 / O8 / O9 / O10) can be updated in one place.

export const NICHIBENREN_SEARCH_URL = 'https://member.nichibenren.or.jp/general_search';

export const LEGAL_NOTICES = Object.freeze({
  ja: Object.freeze({
    zeroFeeNeutral: '完全無料・非営利・中立：利用者・弁護士双方に完全無料です。広告枠、紹介料、報酬分配、順位付け、口コミ、AI推薦はありません（O2=none / O9準拠）。',
    noLegalAdvice: '法的判断・鑑定・推薦の非実施：本アプリは法的判断、鑑定、特定の弁護士の推薦を行いません（弁護士法第72条・第27条遵守）。弁護士の選択と依頼判断は利用者ご自身で行ってください。',
    lawyerCopyRetention: '写しの保持に関する注意：送付内容は弁護士側へ写しが残り、利用者端末から削除しても弁護士側からは消えません（保存期間・管理方針は各法律事務所の方針によります）。',
    relayZeroPlaintext: 'E2EE暗号化と中継の非閲覧：送信前に端末内で弁護士の公開鍵により暗号化（E2EE）されます。中継インフラは暗号化ペイロードの平文を閲覧できません。',
    murakumoNonRetention: '補助推論（murakumo.cloud）の任意利用と非保持：下書き整理の補助推論を使う場合は操作ごとに同意を取り、送信内容の事前プレビューを表示します。サーバー非保持・学習不使用であり、同意しない場合もアプリは100%オフラインで利用できます。',
    nichibenrenCheck: '最新登録状況の確認：送付前に、日本弁護士連合会（日弁連）の「弁護士情報検索」で最新の登録状況をご自身で確認できます。',
    unverifiedWarning: '未照合（自己申告）：この弁護士情報は自己申告であり手動照合が未完了です。実運用での送信はブロックされます。日弁連 弁護士情報検索で最新登録状況を確認してください。',
    expiredHardHold: '有効期限切れ（送信停止・HARD HOLD）：手動照合の有効期限（30日）を過ぎているため、問い合わせ送信はシステム層で停止されています。',
    revokedHardHold: '業務停止・退会・除名（送信停止・HARD HOLD）：資格状態が有効ではないため、問い合わせ送信はシステム層で停止されています。',
    conflictHardGate: '利益相反確認ゲート（AWAI-3235）：本文を復号・閲覧する前に、依頼者名・相手方名による事務所内ローカル台帳の利益相反確認と確認記録が必要です。利益相反が検出された場合、本文の復号はブロックされます。',
    publicReleaseGate: '注記：本ビルドは合成フィクスチャを用いた検証版です。一般公開は法務レビューおよびオーナー判断（O10）完了後に限られます。',
  }),
  en: Object.freeze({
    zeroFeeNeutral: 'Completely free, non-profit, and strictly neutral: free for both users and lawyers. No ads, no referral fees, no fee-splitting, no rankings, no reviews, and no AI recommendations (O2=none / O9 compliant).',
    noLegalAdvice: 'No legal advice, evaluation, or lawyer recommendation: this app never provides legal verdicts, evaluations, or lawyer recommendations (Attorneys Act Art. 72 & 27). You choose and engage a lawyer yourself.',
    lawyerCopyRetention: 'Lawyer copy retention notice: a copy of what you send remains with the lawyer. Deleting your local history on this device does not delete the lawyer’s copy (retention follows each law office’s policy).',
    relayZeroPlaintext: 'E2EE encryption & blind relay: messages are end-to-end encrypted on your device to the lawyer’s public key before dispatch. Relay infrastructure cannot inspect plaintext payloads.',
    murakumoNonRetention: 'Optional structuring assist (murakumo.cloud) & non-retention: if you opt in to neutral intake structuring, each operation requests explicit consent with a full payload preview. Data is not retained on the server and never used for training. Declining leaves the app 100% functional offline.',
    nichibenrenCheck: 'Verify current registration: before sending, you can independently confirm current registration on the Japan Federation of Bar Associations (Nichibenren) Lawyer Search.',
    unverifiedWarning: 'Unverified (self-declared): this record is self-declared and has not completed manual verification. Live sending is blocked. Please check the Nichibenren Lawyer Search.',
    expiredHardHold: 'Verification expired (HARD HOLD): the 30-day manual verification window has expired. Contact dispatch is blocked at the operation layer.',
    revokedHardHold: 'Suspended / withdrawn / disbarred (HARD HOLD): this qualification status is not active. Contact dispatch is blocked at the operation layer.',
    conflictHardGate: 'Conflict-check HARD gate (AWAI-3235): before decrypting or viewing the inquiry body, you must run a local ledger conflict check on client/counterparty names and record confirmation. Detected conflicts block body reveal.',
    publicReleaseGate: 'Notice: this build uses clearly marked synthetic fixtures. Public release remains gated on Legal review and owner decision O10.',
  }),
});

export function getLegalNotices(locale = 'ja') {
  return LEGAL_NOTICES[locale === 'en' ? 'en' : 'ja'];
}

export function requiredConsentDisclosures(locale = 'ja') {
  const n = getLegalNotices(locale);
  return Object.freeze([
    n.zeroFeeNeutral,
    n.noLegalAdvice,
    n.lawyerCopyRetention,
    n.relayZeroPlaintext,
    n.murakumoNonRetention,
    n.nichibenrenCheck,
  ]);
}
