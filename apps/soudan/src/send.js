// Soudan sending & Web parity export (AWAI-3236, ADR 0001 D9 / O1, item #223):
// Hand the assembled consultation memo to the lawyer the user chose through:
// - Android / Awai OS: Tauri soudan_share -> Android ACTION_SEND share sheet
// - Web (https://soudan.itonami.app): Web Share API (navigator.share), device.save (.txt/.md/export.v1 .json),
//   or clipboard copy — ALL behind the same canonical per-operation consent gate (kotoba-client-runtime.js).
// Raw screenshot bytes never cross this boundary.

import {SEND_SELECTOR} from './operations.js';

export const MAX_MEMO_PAYLOAD_CHARS = 65536;

export function detectExecutionRoute({tauriInvoke = null, nav = globalThis.navigator} = {}) {
  if (typeof tauriInvoke === 'function') return 'android-share-sheet';
  if (typeof nav?.share === 'function') return 'web-share';
  return 'web-device-save';
}

function assertBoundedMemo(memo) {
  if (typeof memo !== 'string' || !memo.trim() || memo.length > MAX_MEMO_PAYLOAD_CHARS) {
    throw TypeError('invalid-memo-payload');
  }
  if (/data:image\//i.test(memo)) {
    throw TypeError('image-bytes-forbidden');
  }
}

// Android Tauri handler: shareText hands memo text to the OS share sheet (Tauri soudan_share).
// Runs only after the canonical broker's governor + consent gates.
export function createShareHandler({shareText}) {
  if (typeof shareText !== 'function') throw TypeError('shareText-required');
  return async function shareOperation({payload} = {}) {
    const memo = payload?.memo;
    assertBoundedMemo(memo);
    await shareText(memo);
    return {shared: true, route: 'android-share-sheet'};
  };
}

// Web parity handler: runs behind the exact same canonical broker consent gate on https://soudan.itonami.app.
export function createWebParityHandler({webShare = null, saveFile = null, copyText = null} = {}) {
  return async function webParityOperation({payload} = {}) {
    const mode = payload?.mode ?? 'save-txt';
    const memo = payload?.memo;
    assertBoundedMemo(memo);
    if (mode === 'web-share') {
      if (typeof webShare !== 'function') throw Error('web-share-unavailable');
      await webShare({title: String(payload?.title ?? 'Soudan'), text: memo});
      return {shared: true, route: 'web-share'};
    }
    if (mode === 'clipboard') {
      if (typeof copyText !== 'function') throw Error('clipboard-unavailable');
      await copyText(memo);
      return {copied: true, route: 'web-device-save'};
    }
    if (mode === 'save-txt' || mode === 'save-md' || mode === 'save-json') {
      if (typeof saveFile !== 'function') throw Error('device-save-unavailable');
      const content = mode === 'save-json'
        ? (typeof payload?.exportJson === 'string' ? payload.exportJson : memo)
        : (mode === 'save-md' && typeof payload?.markdown === 'string' ? payload.markdown : memo);
      assertBoundedMemo(content);
      const ext = mode === 'save-json' ? 'json' : mode === 'save-md' ? 'md' : 'txt';
      const mime = mode === 'save-json' ? 'application/json' : mode === 'save-md' ? 'application/octet-stream' : 'text/plain';
      const filename = `soudan-memo.${ext}`;
      const bytes = new TextEncoder().encode(content);
      await saveFile({name: filename, type: mime, bytes});
      return {saved: true, name: filename, route: 'web-device-save'};
    }
    throw TypeError('unsupported-export-mode');
  };
}

export {SEND_SELECTOR};
