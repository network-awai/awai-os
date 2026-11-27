// Centralized legal notices and official public search guide entries for Bengoshi (network.itonami.bengoshi).
// Aligned with Legal addendum, MOJ 2026 注 20 public guide scope, O2=none, O4, O8, O9, AWAI-3235, and Art. 11 (令和8年7月1日施行).

export const NICHIBENREN_SEARCH_URL = 'https://member.nichibenren.or.jp/general_search';
export const HIMAWARI_SEARCH_URL = 'https://www.bengoshikai.jp/';
export const HOUTERASU_URL = 'https://www.houterasu.or.jp/';
export const BAR_CONSULTATION_CENTER_URL = 'https://www.nichibenren.or.jp/legal_advice/search/center.html';

export const PUBLIC_SEARCH_GUIDE_LINKS = Object.freeze([
  Object.freeze({
    id: 'nichibenren-general-search',
    url: NICHIBENREN_SEARCH_URL,
    title: Object.freeze({
      ja: '日本弁護士連合会（日弁連）「弁護士情報検索」',
      en: 'Japan Federation of Bar Associations (Nichibenren) Lawyer Search',
    }),
    summary: Object.freeze({
      ja: '氏名・所属弁護士会・登録番号・法律事務所所在地などから、全国の弁護士の最新登録状況（懲戒処分・業務停止の有無を含む公的登録情報）を直接確認できます。',
      en: 'Directly confirm current nationwide lawyer registration status (name, bar association, registration number, office location) on the official Nichibenren search.',
    }),
    usageSteps: Object.freeze({
      ja: Object.freeze([
        '氏名または法律事務所名、都道府県・所属弁護士会を入力して検索します。',
        '弁護士へ連絡する前に、氏名・所属弁護士会・登録番号が一致しているか確認します。',
      ]),
      en: Object.freeze([
        'Enter lawyer name, office name, prefecture, or bar association.',
        'Verify that name, bar association, and registration number match before contacting an office.',
      ]),
    }),
  }),
  Object.freeze({
    id: 'himawari-search',
    url: HIMAWARI_SEARCH_URL,
    title: Object.freeze({
      ja: 'ひまわりサーチ（日弁連 弁護士情報提供サービス）',
      en: 'Himawari Search (Nichibenren Official Lawyer Information Service)',
    }),
    summary: Object.freeze({
      ja: '日本弁護士連合会が運営する公的な弁護士情報提供サービスです。地域・取扱分野・対応言語・法テラス利用可否などの客観条件で弁護士を探せます。',
      en: 'Official lawyer information service operated by Nichibenren. Search by region, factual practice areas, languages, and Houterasu legal aid availability.',
    }),
    usageSteps: Object.freeze({
      ja: Object.freeze([
        'お住まいの地域や相談内容に近い取扱分野を選択して候補事務所を確認します。',
        '各法律事務所の公式連絡先へ直接予約・問い合わせを行います。',
      ]),
      en: Object.freeze([
        'Filter by region and factual practice area to browse offices.',
        'Contact the selected law office directly using its published contact details.',
      ]),
    }),
  }),
  Object.freeze({
    id: 'houterasu',
    url: HOUTERASU_URL,
    title: Object.freeze({
      ja: '法テラス（日本司法支援センター）',
      en: 'Houterasu (Japan Legal Support Center)',
    }),
    summary: Object.freeze({
      ja: '国によって設立された公的な法的トラブル解決の総合案内所です。資力要件を満たす方は無料法律相談や弁護士費用の立替制度（民事法律扶助）を利用できます。',
      en: 'National public legal support center. Eligible individuals can use free legal consultations and civil legal aid fee-advance programs.',
    }),
    usageSteps: Object.freeze({
      ja: Object.freeze([
        '資力要件や相談予約方法を確認し、お近くの法テラス地方事務所またはサポートダイヤルへ連絡します。',
        '相談メモ（日時・経緯・書類一覧）を手元に用意しておくとスムーズです。',
      ]),
      en: Object.freeze([
        'Check eligibility requirements and booking instructions for your local Houterasu office.',
        'Prepare your factual consultation memo (timeline, documents, parties) beforehand.',
      ]),
    }),
  }),
  Object.freeze({
    id: 'bar-consultation-centers',
    url: BAR_CONSULTATION_CENTER_URL,
    title: Object.freeze({
      ja: '全国弁護士会 法律相談センター案内（日弁連）',
      en: 'Nationwide Bar Association Legal Consultation Centers (Nichibenren)',
    }),
    summary: Object.freeze({
      ja: '全国各地の弁護士会が運営する法律相談センターの一覧・予約案内です。お近くの弁護士会の窓口から対面・電話等の法律相談を予約できます。',
      en: 'Directory of legal consultation centers operated by local bar associations across Japan for booking in-person or phone consultations.',
    }),
    usageSteps: Object.freeze({
      ja: Object.freeze([
        '都道府県ごとの弁護士会法律相談センターを選び、予約窓口・相談料・受付時間を確認します。',
        '利益相反確認のため、相談者氏名と相手方名称を正確に伝えられるよう準備します。',
      ]),
      en: Object.freeze([
        'Choose your prefecture bar association consultation center and check hours and fees.',
        'Prepare your name and counterparty name for the center’s conflict check.',
      ]),
    }),
  }),
]);

export const PREVIEW_BANNER_JA = 'プレビュー版（架空サンプル表示）：実在する弁護士・法律事務所の掲載・登録受付・連絡取次は外部弁護士確認（O10）の完了後に開始します。';
export const PREVIEW_BANNER_EN = 'Preview (Synthetic Samples Only): Listing, registration intake, and contact handling for real lawyers/law offices will begin only after external legal review (O10) is completed.';

export const AGENT_NON_RECOMMENDATION_GUARD_JA = '[AGENT_GUARD] 特定の弁護士の選択・比較・順位付け・法的判断は禁止されています。氏名・所属弁護士会等の客観的事実のみを中立に提示し、選択と連絡判断は利用者に委ねてください。';
export const AGENT_NON_RECOMMENDATION_GUARD_EN = '[AGENT_GUARD] Selecting, ranking, comparing, or giving legal advice about lawyers is prohibited. Present only neutral factual fields including Art. 9 name and bar association, and leave the choice strictly to the user.';

export const LEGAL_NOTICES = Object.freeze({
  ja: Object.freeze({
    previewBanner: PREVIEW_BANNER_JA,
    zeroFeeNeutral: '完全無料・対価 ¥0・厳格中立：利用者・弁護士双方に完全無料です。広告枠、対価、報酬分配、順位付け、評価・口コミ、AI選択補助はありません（O2=none / O9準拠）。',
    noLegalAdvice: '法的判断・鑑定・特定候補の推奨は非実施：本アプリは法的判断、鑑定、特定の弁護士の推奨を行いません（弁護士法第72条・第27条遵守）。弁護士の選択と連絡判断は利用者ご自身で行ってください。',
    methodADirect: '方式 A（直接連絡・サーバ中継なし）：弁護士の公開事務所 URL・メール（mailto:）・電話（tel:）への直接遷移と、7行の連絡先コピー・下書きコピーのみを端末内で提供します。運営サーバによる連絡中継や外部通信は一切行いません（app-descriptor operations = []）。',
    lawyerCopyRetention: '写しの保持に関する注意：法律事務所へ直接送付した内容は各法律事務所側で管理されます。本端末内の下書き・履歴を削除しても、事務所へ送付済みの写しは消えません。',
    nichibenrenCheck: '最新登録状況の確認：連絡する前に、日本弁護士連合会（日弁連）の「弁護士情報検索」で最新の登録状況をご自身で確認できます。',
    unverifiedWarning: '未照合（自己申告）：このサンプル記録は自己申告であり手動照合が未完了です。日弁連「弁護士情報検索」で最新登録状況を確認してください。',
    expiredHardHold: '有効期限切れ（連絡停止・HARD HOLD）：手動照合の有効期限（30日）を過ぎているため、連絡先コピー・連絡操作はシステム層で停止されています。',
    revokedHardHold: '業務停止・退会・除名（連絡停止・HARD HOLD）：資格状態が有効ではないため、連絡先コピー・連絡操作はシステム層で停止されています。',
    conflictHardGate: '利益相反確認ゲート（AWAI-3235・ローカルプレビュー専用）：本文を復号・閲覧する前に、依頼者名・相手方名による事務所内ローカル台帳の利益相反確認と確認記録が必要です。利益相反が検出された場合、本文の復号はブロックされます（サーバ中継なし）。',
    art11Policy: '業務広告規程第11条（令和8年7月1日施行済み）：掲載内容スナップショット・変更履歴・無料掲載条件（対価 ¥0）を 3 年保存用に端末内で JSON エクスポートできます。',
    publicReleaseGate: '注記：本ビルドは公的弁護士検索ガイドと架空サンプルを用いたプレビュー版です。実在弁護士の掲載・登録受付・連絡取次は外部弁護士確認（O10）完了後に限られます。',
    soudanFirewall: 'URL クエリ境界（Soudan → Bengoshi 遮断）：URL クエリに相談本文やタグ等が含まれていても読み込まず破棄します。相談メモの取り込みは利用者自身の明示的な JSON 読込操作のみで行います。',
  }),
  en: Object.freeze({
    previewBanner: PREVIEW_BANNER_EN,
    zeroFeeNeutral: 'Completely free (JPY 0) and strictly neutral: free for both users and lawyers. No ads, no fees, no fee-splitting, no rankings, no reviews, and no AI picks (O2=none / O9 compliant).',
    noLegalAdvice: 'No legal advice, evaluation, or lawyer picking: this app never provides legal verdicts, evaluations, or picks (Attorneys Act Art. 72 & 27). You choose and contact a lawyer yourself.',
    methodADirect: 'Method A (direct contact, zero server relay): provides direct links to the office URL, mailto:, tel:, and local 7-line Copy Contact + Copy Draft buttons. Zero platform server relay and zero external network calls (app-descriptor operations = []).',
    lawyerCopyRetention: 'Office copy notice: anything you send directly to a law office is governed by that office’s retention policy. Deleting local drafts on this device does not delete copies already sent.',
    nichibenrenCheck: 'Verify current registration: before contacting any lawyer, independently confirm current registration on the Nichibenren Lawyer Search.',
    unverifiedWarning: 'Unverified (self-declared): this synthetic sample has not completed manual verification. Always confirm registration on Nichibenren Lawyer Search.',
    expiredHardHold: 'Verification expired (HARD HOLD): the 30-day manual verification window has expired. Manual Copy Contact and inquiry actions are blocked at the operation layer.',
    revokedHardHold: 'Suspended / withdrawn / disbarred (HARD HOLD): qualification status is not active. Manual Copy Contact and inquiry actions are blocked at the operation layer.',
    conflictHardGate: 'Conflict-check HARD gate (AWAI-3235 — local preview/offline import only): before decrypting or viewing the body, run a local ledger conflict check on client/counterparty names and record confirmation. Detected conflicts block reveal. Zero server relay.',
    art11Policy: 'Advertising Rules Art. 11 (enforced 2026-07-01): export a timestamped listing snapshot, edit history, and zero-fee terms (fee_jpy: 0) locally for 3-year preservation.',
    publicReleaseGate: 'Notice: this build provides the official lawyer search guide and synthetic sample previews. Real lawyer listing, registration intake, and contact handling remain closed until O10 completion.',
    soudanFirewall: 'URL query firewall (Soudan -> Bengoshi): consultation text or tag query parameters in URLs are ignored and rejected. Only explicit user JSON import is accepted.',
  }),
});

export const LAWYER_PARTICIPATION_POLICY = Object.freeze({
  ja: Object.freeze([
    '完全無料・対価 ¥0：利用者・弁護士双方に利用料、掲載料、成功報酬、広告枠、有料枠、トークン報酬は一切ありません（O2=none）。',
    '7 遮断境界：対価遮断（O2）、資格照合遮断（O4）、通信・サーバ非経由遮断（O8・operations=[]）、評価・順位・スカウト遮断（O9）、利益相反 HARD ゲート（AWAI-3235）、Soudan→Bengoshi URL クエリ遮断、方式 A 直接遷移（サーバ中継遮断）を構造上実装しています。',
    'O4 手動確認：日弁連・官報のスクレイピングおよび身分証写真のみの本人確認は禁止し、目視照合＋法律事務所実在確認連絡（a2方式・30日TTL）を採用予定です。',
    '業務広告規程 11 条 3 年保存対応予定：令和 8 年 7 月 1 日施行済みの規程 11 条に対応し、掲載内容・変更履歴・無料参加条件（fee_jpy: 0）の 3 年保存用エクスポート（lawyer.export_art11_record）を備えています。',
    '受付開始時期：実在する弁護士・法律事務所の登録受付・掲載は外部弁護士確認（O10）の完了後に開始します（現在は架空サンプルのプレビュー表示のみ）。',
  ]),
  en: Object.freeze([
    'Completely free (JPY 0): zero fees for users and zero fees for lawyers — no listing fees, commissions, ads, paid tiers, or token rewards (O2=none).',
    '7 isolation boundaries: zero-fee (O2), verification holds (O4), zero external calls (O8, operations=[]), neutrality/anti-scout (O9), conflict-check HARD gate (AWAI-3235), Soudan->Bengoshi query firewall, and Method A direct handoff (zero server relay).',
    'O4 manual verification: zero scraping and zero ID-photo-only checks; manual Nichibenren check plus office contact confirmation (a2, 30-day TTL).',
    'Art. 11 3-year preservation export: supports local timestamped export (lawyer.export_art11_record) of listing snapshots, edit history, and zero-fee participation terms (fee_jpy: 0) per Advertising Rules Art. 11 (effective 2026-07-01).',
    'Intake launch gate: live registration and listings for real lawyers open only after external legal review (O10) is completed.',
  ]),
});

export function getLegalNotices(locale = 'ja') {
  return LEGAL_NOTICES[locale === 'en' ? 'en' : 'ja'];
}

export function getParticipationPolicy(locale = 'ja') {
  return LAWYER_PARTICIPATION_POLICY[locale === 'en' ? 'en' : 'ja'];
}

export function requiredConsentDisclosures(locale = 'ja') {
  const n = getLegalNotices(locale);
  return Object.freeze([
    n.zeroFeeNeutral,
    n.noLegalAdvice,
    n.methodADirect,
    n.lawyerCopyRetention,
    n.nichibenrenCheck,
    n.art11Policy,
  ]);
}
