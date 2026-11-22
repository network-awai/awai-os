// Soudan sending (AWAI-3236, scope ADR 0001 D9 / owner decision O1): hand the
// assembled consultation memo to the lawyer the user chose, through the
// Android share sheet. The canonical broker owns both gates and calls this
// handler at most once per approved invocation:
// - governor review: the declared send operation must be in the broker's
//   eligible operations (approvedOperations intersected with
//   hostSupportedOperations). Otherwise invoke() refuses before consent.
// - user approval: broker.invoke() shows the canonical per-operation consent
//   dialog and runs this handler only when the user approves this operation.
//   Denial throws, and the memo is never handed to the OS.
// So an approval delivers the memo exactly once; a denial delivers nothing.
import {SEND_SELECTOR} from './operations.js';

// shareText hands memo text to the OS share sheet (the Tauri soudan_share
// command on Android). It runs only after the broker's consent gate.
export function createShareHandler({shareText}) {
  if (typeof shareText !== 'function') throw TypeError('shareText-required');
  return async function shareOperation({payload} = {}) {
    const memo = payload?.memo;
    if (typeof memo !== 'string' || !memo.trim() || memo.length > 65536) throw TypeError('invalid-memo-payload');
    await shareText(memo);
    return {shared: true};
  };
}
