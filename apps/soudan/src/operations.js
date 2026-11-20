// External operations of Soudan (kotoba.app.client-runtime.v1).
// None are declared. ADR 0001 D9 allows sending the memo to a lawyer the user chose (X1), but its service and
// endpoint are not decided: the canonical runtime's browser-action endpoint needs an https service origin, and
// handing the memo to the user's own mail app (Android share sheet) has none. Until the runtime has a shape for
// that, X1 stays undeclared and the broker refuses it (fail closed).
export const SEND_SELECTOR = Object.freeze({capability: 'itonami.soudan.send', service: 'user-chosen-lawyer', operation: 'send-consultation-memo'});
export const REQUESTED_CAPABILITIES = Object.freeze([]);
export function runtimeDescriptor() {
  return {schema: 'kotoba.app.client-runtime.v1', target: 'browser', profile: 'trusted-page-v1', entry: 'index.html',
    'local-state': {adapter: 'localstorage', schema: 'itonami.soudan.draft.v1', version: 1}, workers: [], operations: []};
}
