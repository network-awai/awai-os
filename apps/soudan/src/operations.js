// External operations of Soudan (kotoba.app.client-runtime.v1, restricted-wasm-v1).
// Two operations are declared:
// 1. X1 send/share hand-off (ADR 0001 D9 / owner decision O1): handing the assembled consultation memo
//    to the lawyer the user chose, through the OS share sheet / Web parity hand-off (browser-action: share,
//    recipient: user-selected-app; no service origin is fabricated).
// 2. Optional in-house murakumo.cloud draft organization slot (soudan.inference.organize): synchronous
//    POST https://api.murakumo.cloud/v1/chat/completions ONLY (never free-tier external proxies), fail-closed by default
//    until pre-launch Legal item #224 blockers & in-house endpoint readiness are confirmed.
// Canonical broker vendored from kotoba-lang/kotoba (see otehon/shell/vendor/PINS.json).

export const SEND_SELECTOR = Object.freeze({
  capability: 'itonami.soudan.send',
  service: 'user-chosen-lawyer',
  operation: 'send-consultation-memo',
});

export const INFERENCE_SELECTOR = Object.freeze({
  capability: 'itonami.soudan.inference',
  service: 'murakumo-cloud',
  operation: 'organize-consultation-draft',
});

export const MURAKUMO_ORIGIN = 'https://api.murakumo.cloud';
export const MURAKUMO_PATH = '/v1/chat/completions';
export const MURAKUMO_READY_PATH = '/ready';
export const MURAKUMO_PINNED_MODEL = 'mishima';
export const FOREIGN_INFO_URL = 'https://soudan.itonami.app/foreign-info.html#murakumo';

// First-screen disclosure facts (KOTOBA-159 finding 9) follow the dialog language:
// the canonical broker localizes its own labels, while recipient/data/purpose/special-care-kinds/note
// are shown as declared. Placeholders clearly mark items awaiting Legal item #224 confirmation.
const DISCLOSURE_FACTS = Object.freeze({
  ja: Object.freeze({
    recipient: '利用者がこの端末で選ぶアプリ',
    data: Object.freeze(['相談メモ（氏名、連絡先、相談内容）']),
    purpose: '利用者が選んだ弁護士に相談メモを送る',
    withdrawal: '設定',
    specialCareKinds: Object.freeze(['相談メモに含まれ得る要配慮個人情報（病歴・犯罪歴等。Legal確認中）']),
    note: '画像原本は送信されません。送信前に実名・要配慮個人情報の要否を確認してください（Legal O8文言確認中）。',
  }),
  en: Object.freeze({
    recipient: 'the app you choose on this device',
    data: Object.freeze(['consultation memo (name, contact, consultation details)']),
    purpose: 'to send the consultation memo to the lawyer you chose',
    withdrawal: 'Settings',
    specialCareKinds: Object.freeze(['special-care data if entered (health/criminal; Legal TBD)']),
    note: 'Raw image bytes are never sent. Review personal or sensitive data before sending (Legal O8 wording pending).',
  }),
});

// Route B honest disclosure for murakumo.cloud (Legal addendum §1.5, item #224):
// Names Awai Network LLC (US legal entity), discloses possible Cloudflare / Hugging Face / Modal / OpenRouter
// routing, explicitly avoids false non-retention or country-lock guarantees, and warns users to anonymize.
const INFERENCE_DISCLOSURE_FACTS = Object.freeze({
  ja: Object.freeze({
    recipient: 'Awai Network LLC',
    countryName: 'アメリカ合衆国（米国法人）',
    data: Object.freeze(['匿名化後の相談メモ下書きテキスト（画像バイト除く）']),
    purpose: '相談前メモの事実・経緯・質問項目を自己整理する（法的助言ではありません）',
    specialCareKinds: Object.freeze(['誤入力され得る要配慮個人情報（病歴・犯罪歴等。入力しないでください／Legal確認中）']),
    note: '通常APIは学習・評価不使用。ただし処理国の固定やサービス全体での非保持は保証されません。実名・連絡先・要配慮個人情報は「Aさん」等に置換してください（Legal確認中）。',
  }),
  en: Object.freeze({
    recipient: 'Awai Network LLC',
    countryName: 'United States',
    data: Object.freeze(['anonymized consultation draft text (no image bytes)']),
    purpose: 'Organize consultation memo facts and questions (not legal advice)',
    specialCareKinds: Object.freeze(['sensitive data if entered (do not enter; Legal O8 pending)']),
    note: 'Not used for model training/evaluation; fixed country-of-processing and service-wide non-retention are not guaranteed. Anonymize names/contacts/sensitive data first (Legal O8 pending).',
  }),
});

export function disclosureFacts(locale = 'ja') {
  return DISCLOSURE_FACTS[locale === 'en' ? 'en' : 'ja'];
}

export function inferenceDisclosureFacts(locale = 'ja') {
  return INFERENCE_DISCLOSURE_FACTS[locale === 'en' ? 'en' : 'ja'];
}

function sendOperation(locale = 'ja') {
  const facts = disclosureFacts(locale);
  return Object.freeze({
    ...SEND_SELECTOR,
    consent: 'each-operation',
    'data-categories': Object.freeze(['legal.consultation-memo']),
    endpoint: Object.freeze({'browser-action': 'share', recipient: 'user-selected-app'}),
    disclosure: Object.freeze({
      recipient: facts.recipient,
      country: 'JP',
      data: facts.data,
      'special-care': true,
      'special-care-kinds': facts.specialCareKinds,
      purpose: facts.purpose,
      frequency: 'one-time',
      withdrawal: facts.withdrawal,
      note: facts.note,
    }),
  });
}

function inferenceOperation(locale = 'ja') {
  const facts = inferenceDisclosureFacts(locale);
  return Object.freeze({
    ...INFERENCE_SELECTOR,
    consent: 'each-operation',
    'data-categories': Object.freeze(['consultation-draft-text']),
    endpoint: Object.freeze({
      origin: MURAKUMO_ORIGIN,
      routes: Object.freeze([
        Object.freeze({method: 'POST', path: MURAKUMO_PATH, 'query-params': Object.freeze([])}),
        Object.freeze({
          method: 'GET',
          path: MURAKUMO_READY_PATH,
          'query-params': Object.freeze(['model']),
          'query-values': Object.freeze({model: MURAKUMO_PINNED_MODEL}),
        }),
      ]),
    }),
    'request-body': 'text',
    'max-request-bytes': 65536,
    'content-type': 'application/json',
    'response-body': 'text',
    'max-response-bytes': 65536,
    'timeout-ms': 30000,
    disclosure: Object.freeze({
      recipient: facts.recipient,
      country: 'US',
      'country-name': facts.countryName,
      'foreign-info-url': FOREIGN_INFO_URL,
      data: facts.data,
      'special-care': true,
      'special-care-kinds': facts.specialCareKinds,
      purpose: facts.purpose,
      frequency: 'one-time',
      note: facts.note,
    }),
  });
}

export const SEND_OPERATION = sendOperation('ja');
export const INFERENCE_OPERATION = inferenceOperation('ja');
export const REQUESTED_CAPABILITIES = Object.freeze([SEND_SELECTOR.capability, INFERENCE_SELECTOR.capability]);

export function runtimeDescriptor(locale = 'ja') {
  const lang = locale === 'en' ? 'en' : 'ja';
  return {
    schema: 'kotoba.app.client-runtime.v1',
    target: 'browser',
    profile: 'restricted-wasm-v1',
    entry: 'guest.html',
    'local-state': {adapter: 'localstorage', schema: 'itonami.soudan.state.v2', version: 2},
    'host-local': {
      schema: 'kotoba.host-local.v1',
      'app-id': 'network.itonami.soudan',
      calls: ['storage.get', 'storage.put', 'storage.delete', 'device.save'],
      storage: {
        class: 'device-only',
        backup: 'excluded',
        'at-rest': 'encrypted',
        erasable: true,
        'quota-bytes': 1048576,
        'max-entries': 64,
        'max-value-bytes': 262144,
      },
      stores: ['soudan-state'],
      save: {
        'max-bytes': 262144,
        'mime-types': ['text/plain', 'application/json', 'application/octet-stream'],
        'octet-stream-extensions': ['md'],
      },
    },
    workers: [],
    operations: [
      lang === 'ja' ? SEND_OPERATION : sendOperation('en'),
      lang === 'ja' ? INFERENCE_OPERATION : inferenceOperation('en'),
    ],
  };
}
