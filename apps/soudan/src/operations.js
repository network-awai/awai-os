// External operations of Soudan (kotoba.app.client-runtime.v1).
// One operation is declared (AWAI-3236, scope ADR 0001 D9 / owner decision O1):
// handing the assembled consultation memo to a lawyer the user chose (X1),
// through the Android share sheet. The receiver is whatever app the user picks
// in the OS chooser, so no service origin is declared; the endpoint names the
// share-sheet action and the fixed 'user-selected-app' recipient marker.
// Canonical broker vendored from kotoba-lang/kotoba (see otehon/shell/vendor/PINS.json);
// the operation declares the finding-9 disclosure the broker shows before sending.
export const SEND_SELECTOR = Object.freeze({capability: 'itonami.soudan.send', service: 'user-chosen-lawyer', operation: 'send-consultation-memo'});
// First-screen disclosure facts (KOTOBA-159 finding 9) follow the dialog language (App QA r2 point 1):
// the canonical broker localizes its own labels, but recipient/data/purpose/withdrawal are shown as
// declared. The receiver is whatever app the user picks on this device; the memo's 宛先/To line
// (model.js addressedMemo) carries the lawyer the user typed. No lawyer list is held (ADR D9).
const DISCLOSURE_FACTS = Object.freeze({
  ja: Object.freeze({recipient: '利用者がこの端末で選ぶアプリ',
    data: Object.freeze(['相談メモ（氏名、連絡先、相談内容）']),
    purpose: '利用者が選んだ弁護士に相談メモを送る', withdrawal: '設定'}),
  en: Object.freeze({recipient: 'the app you choose on this device',
    data: Object.freeze(['consultation memo (name, contact, consultation details)']),
    purpose: 'to send the consultation memo to the lawyer you chose', withdrawal: 'Settings'}),
});
export function disclosureFacts(locale = 'ja') {
  return DISCLOSURE_FACTS[locale === 'en' ? 'en' : 'ja'];
}
function sendOperation(locale = 'ja') {
  const facts = disclosureFacts(locale);
  return Object.freeze({...SEND_SELECTOR,
    consent: 'each-operation',
    'data-categories': ['legal.consultation-memo'],
    endpoint: Object.freeze({'browser-action': 'share', recipient: 'user-selected-app'}),
    // First-screen disclosure (KOTOBA-159 finding 9, required by the canonical broker): declared facts
    // shown as written.
    disclosure: Object.freeze({recipient: facts.recipient, country: 'JP',
      data: facts.data, 'special-care': false,
      purpose: facts.purpose, frequency: 'one-time', withdrawal: facts.withdrawal})});
}
export const SEND_OPERATION = sendOperation('ja');
export const REQUESTED_CAPABILITIES = Object.freeze([SEND_SELECTOR.capability]);
export function runtimeDescriptor(locale = 'ja') {
  const lang = locale === 'en' ? 'en' : 'ja';
  return {schema: 'kotoba.app.client-runtime.v1', target: 'browser', profile: 'trusted-page-v1', entry: 'index.html',
    'local-state': {adapter: 'localstorage', schema: 'itonami.soudan.draft.v1', version: 1}, workers: [], operations: [lang === 'ja' ? SEND_OPERATION : sendOperation('en')]};
}
