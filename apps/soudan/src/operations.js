// External operations of Soudan (kotoba.app.client-runtime.v1).
// One operation is declared (AWAI-3236, scope ADR 0001 D9 / owner decision O1):
// handing the assembled consultation memo to a lawyer the user chose (X1),
// through the Android share sheet. The receiver is whatever app the user picks
// in the OS chooser, so no service origin is declared; the endpoint names the
// share-sheet action and the fixed 'user-selected-app' recipient marker
// (vendored from kotoba-lang/kotoba#1358, AWAI-3336 pin kept as-is).
export const SEND_SELECTOR = Object.freeze({capability: 'itonami.soudan.send', service: 'user-chosen-lawyer', operation: 'send-consultation-memo'});
export const SEND_OPERATION = Object.freeze({...SEND_SELECTOR,
  consent: 'each-operation',
  'data-categories': ['legal.consultation-memo'],
  endpoint: Object.freeze({'browser-action': 'share', recipient: 'user-selected-app'})});
export const REQUESTED_CAPABILITIES = Object.freeze([SEND_SELECTOR.capability]);
export function runtimeDescriptor() {
  return {schema: 'kotoba.app.client-runtime.v1', target: 'browser', profile: 'trusted-page-v1', entry: 'index.html',
    'local-state': {adapter: 'localstorage', schema: 'itonami.soudan.draft.v1', version: 1}, workers: [], operations: [SEND_OPERATION]};
}
