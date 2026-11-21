// External operations of Soudan (kotoba.app.client-runtime.v1).
// One operation is declared (AWAI-3236, scope ADR 0001 D9 / owner decision O1):
// handing the assembled consultation memo to a lawyer the user chose (X1),
// through the Android share sheet. The receiver is whatever app the user picks
// in the OS chooser, so no service origin is declared; the endpoint names the
// share-sheet action and the fixed 'user-selected-app' recipient marker.
// Canonical broker vendored from kotoba-lang/kotoba (see otehon/shell/vendor/PINS.json);
// the operation declares the finding-9 disclosure the broker shows before sending.
export const SEND_SELECTOR = Object.freeze({capability: 'itonami.soudan.send', service: 'user-chosen-lawyer', operation: 'send-consultation-memo'});
export const SEND_OPERATION = Object.freeze({...SEND_SELECTOR,
  consent: 'each-operation',
  'data-categories': ['legal.consultation-memo'],
  endpoint: Object.freeze({'browser-action': 'share', recipient: 'user-selected-app'}),
  // First-screen disclosure (KOTOBA-159 finding 9, required by the canonical broker): declared facts
  // shown as written. The receiver is whatever app the user picks on this device; the memo's 宛先 line
  // (model.js addressedMemo) carries the lawyer the user typed. No lawyer list is held (ADR D9).
  disclosure: Object.freeze({recipient: '利用者がこの端末で選ぶアプリ', country: 'JP',
    data: Object.freeze(['相談メモ（氏名、連絡先、相談内容）']), 'special-care': false,
    purpose: '利用者が選んだ弁護士に相談メモを送る', frequency: 'one-time', withdrawal: '設定'})});
export const REQUESTED_CAPABILITIES = Object.freeze([SEND_SELECTOR.capability]);
export function runtimeDescriptor() {
  return {schema: 'kotoba.app.client-runtime.v1', target: 'browser', profile: 'trusted-page-v1', entry: 'index.html',
    'local-state': {adapter: 'localstorage', schema: 'itonami.soudan.draft.v1', version: 1}, workers: [], operations: [SEND_OPERATION]};
}
