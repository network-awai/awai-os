// External operations descriptor for Bengoshi (kotoba.app.client-runtime.v1).
// Enforces:
// - Zero requests to app origin (O8)
// - Each-operation consent with canonical KOTOBA-159 finding-9 disclosures
// - AWAI-3883 countryStatus: "pending" for murakumo.cloud until operator registration country is independently confirmed
// - Relay staged / fail-closed: inquiry.send and inquiry.reply use client-side E2EE envelopes without fabricating an unverified relay origin

export const MURAKUMO_ORIGIN = 'https://murakumo.cloud';
export const DEFAULT_MURAKUMO_PATH = '/v1/chat/completions';

export const INFERENCE_SELECTOR = Object.freeze({
  capability: 'itonami.bengoshi.inference',
  service: 'murakumo.inference',
  operation: 'assist-intake-structure',
});

export const INQUIRY_SEND_SELECTOR = Object.freeze({
  capability: 'itonami.bengoshi.inquiry',
  service: 'chosen-lawyer-e2ee',
  operation: 'send-encrypted-inquiry',
});

export const INQUIRY_REPLY_SELECTOR = Object.freeze({
  capability: 'itonami.bengoshi.inquiry',
  service: 'chosen-lawyer-e2ee',
  operation: 'send-encrypted-reply',
});

export const REQUESTED_CAPABILITIES = Object.freeze([
  INFERENCE_SELECTOR.capability,
  INQUIRY_SEND_SELECTOR.capability,
]);

const DISCLOSURES = Object.freeze({
  ja: Object.freeze({
    inference: Object.freeze({
      recipient: 'Murakumo 推論サービス運営者（murakumo.cloud）',
      country: null,
      countryStatus: 'pending',
      note: '下書き整理の補助推論のみに使用し、法的判断・推薦は行いません。サーバー非保持・学習不使用。事業者の登録国は独立確認中です。',
      confirmCondition: '運営事業者の法人登記および登録国の独立確認完了後に国コードを確定します',
      data: Object.freeze(['相談下書きのテキスト（整理対象として利用者が選択した範囲のみ）']),
      'special-care': false,
      purpose: '相談メモの項目整理を補助する（法的判断・弁護士推薦は行わない）',
      frequency: 'one-time',
      withdrawal: '設定',
    }),
    inquirySend: Object.freeze({
      recipient: '利用者が選んだ弁護士（E2EE暗号化・中継先は未設定のためローカル検証のみ）',
      country: 'JP',
      countryStatus: 'confirmed',
      note: '送信前に端末内でE2EE暗号化され、中継インフラは平文を閲覧できません。弁護士側へ写しが残ります。',
      data: Object.freeze(['E2EE暗号化済み相談問い合わせペイロード（利益相反確認ヘッダ含む）']),
      'special-care': false,
      purpose: '利用者が選んだ弁護士へ暗号化済み相談問い合わせを送付する',
      frequency: 'one-time',
      withdrawal: '設定',
    }),
    inquiryReply: Object.freeze({
      recipient: '相談者（E2EE暗号化・中継先は未設定のためローカル検証のみ）',
      country: 'JP',
      countryStatus: 'confirmed',
      note: '送信前に端末内でE2EE暗号化されます。利益相反確認完了後の応答のみ許可されます。',
      data: Object.freeze(['E2EE暗号化済み弁護士応答ペイロード']),
      'special-care': false,
      purpose: '利益相反確認完了後に相談者へ暗号化済み応答を送付する',
      frequency: 'one-time',
      withdrawal: '設定',
    }),
  }),
  en: Object.freeze({
    inference: Object.freeze({
      recipient: 'Murakumo Inference Operator (murakumo.cloud)',
      country: null,
      countryStatus: 'pending',
      note: 'Used only for neutral intake structuring; no legal advice or lawyer recommendation. Not retained or used for training. Operator country pending confirmation.',
      confirmCondition: 'Country code will be confirmed after independent verification of operator corporate registration',
      data: Object.freeze(['Consultation draft text selected by the user for neutral structuring']),
      'special-care': false,
      purpose: 'Assist neutral structuring of consultation intake notes (no legal advice or recommendation)',
      frequency: 'one-time',
      withdrawal: 'Settings',
    }),
    inquirySend: Object.freeze({
      recipient: 'The lawyer you chose (E2EE encrypted; relay staged/disabled)',
      country: 'JP',
      countryStatus: 'confirmed',
      note: 'Encrypted end-to-end on device before dispatch. Relay cannot read plaintext. A copy remains with the lawyer.',
      data: Object.freeze(['E2EE-encrypted consultation inquiry envelope and conflict-check header']),
      'special-care': false,
      purpose: 'Send an E2EE-encrypted consultation inquiry to the lawyer you chose',
      frequency: 'one-time',
      withdrawal: 'Settings',
    }),
    inquiryReply: Object.freeze({
      recipient: 'The inquiring user (E2EE encrypted; relay staged/disabled)',
      country: 'JP',
      countryStatus: 'confirmed',
      note: 'Encrypted end-to-end on device before dispatch. Permitted only after conflict-check clearance.',
      data: Object.freeze(['E2EE-encrypted lawyer reply envelope']),
      'special-care': false,
      purpose: 'Send an E2EE-encrypted reply to the user after conflict-check clearance',
      frequency: 'one-time',
      withdrawal: 'Settings',
    }),
  }),
});

export function disclosureSet(locale = 'ja') {
  return DISCLOSURES[locale === 'en' ? 'en' : 'ja'];
}

export function runtimeDescriptor(locale = 'ja', { murakumoPath = DEFAULT_MURAKUMO_PATH } = {}) {
  const d = disclosureSet(locale);
  const path = typeof murakumoPath === 'string' && murakumoPath.startsWith('/') && !murakumoPath.includes('..') && !murakumoPath.includes('?')
    ? murakumoPath
    : DEFAULT_MURAKUMO_PATH;

  return {
    schema: 'kotoba.app.client-runtime.v1',
    target: 'browser',
    profile: 'trusted-page-v1',
    entry: 'index.html',
    'local-state': {
      adapter: 'localstorage',
      schema: 'itonami.bengoshi.state.v1',
      version: 1,
    },
    workers: [],
    operations: [
      Object.freeze({
        ...INFERENCE_SELECTOR,
        consent: 'each-operation',
        'data-categories': ['legal.inquiry-draft-structure'],
        endpoint: Object.freeze({
          origin: MURAKUMO_ORIGIN,
          method: 'POST',
          path,
        }),
        'request-body': 'text',
        'max-request-bytes': 32768,
        'content-type': 'application/json',
        'response-body': 'text',
        'max-response-bytes': 32768,
        'timeout-ms': 30000,
        disclosure: d.inference,
      }),
      Object.freeze({
        ...INQUIRY_SEND_SELECTOR,
        consent: 'each-operation',
        'data-categories': ['legal.e2ee-inquiry-envelope'],
        endpoint: Object.freeze({
          'browser-action': 'e2ee-inquiry-dispatch',
          recipient: 'user-selected-app',
        }),
        disclosure: d.inquirySend,
      }),
      Object.freeze({
        ...INQUIRY_REPLY_SELECTOR,
        consent: 'each-operation',
        'data-categories': ['legal.e2ee-reply-envelope'],
        endpoint: Object.freeze({
          'browser-action': 'e2ee-reply-dispatch',
          recipient: 'user-selected-app',
        }),
        disclosure: d.inquiryReply,
      }),
    ],
  };
}
