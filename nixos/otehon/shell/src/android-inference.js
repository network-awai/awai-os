import {createInferenceClient} from './inference-client.gen.js';
export function androidInferenceAvailable(){return /Android/.test(globalThis.navigator?.userAgent||'')&&typeof globalThis.__TAURI_INTERNALS__?.invoke==='function';}
export const localInference=createInferenceClient();
